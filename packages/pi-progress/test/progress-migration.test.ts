import assert from "node:assert/strict";
import { type AgentTool, runToolCall } from "@earendil-works/pi-agent-core";
import type { ContextEvent, SessionEntry } from "@earendil-works/pi-coding-agent";
import { Compile } from "typebox/compile";
import { test } from "vitest";
import {
  ProgressParameters,
  type ProgressStep,
  prepareProgressArguments,
  reconcileProgressContext,
  reconstructProgress,
} from "../src/progress-state.js";
import {
  createContext,
  createHarness,
  customEntry,
  identityTheme,
  progressToolCallMessage,
  progressToolResultMessage,
  setProgress,
  toolResultEntry,
} from "./progress-harness.js";

const summary = { role: "compactionSummary", summary: "Earlier work", tokensBefore: 100, timestamp: 0 } as const;
const versions = [3, 4] as const;
const toolName = (version: 3 | 4) => (version === 3 ? "update_todo_list" : "update_progress");
const argumentKey = (version: 3 | 4) => (version === 3 ? "todos" : "steps");
const legacyStep = (version: 3 | 4, text: string, reason: unknown) => ({
  [version === 3 ? "step" : "text"]: text,
  status: "blocked",
  reason,
});
const legacyDetails = (version: 3 | 4, steps: unknown[]) => ({ version, [argumentKey(version)]: steps });

for (const [name, unit] of [
  ["ASCII", "x"],
  ["CJK", "界"],
  ["combining marks", "e\u0301"],
  ["ZWJ emoji", "👨‍👩‍👧‍👦"],
  ["regional indicators", "🇹🇼"],
] as const) {
  test(`lossless maximum-length migration and actual Pi resubmission: ${name}`, async () => {
    const text = unit.repeat(300);
    const reason = unit.repeat(200);
    const steps: ProgressStep[] = [{ text: `${text} — ${reason}`, status: "blocked" }];
    for (const version of versions) {
      const original = legacyDetails(version, [legacyStep(version, text, reason)]);
      const entry = toolResultEntry(original, toolName(version));
      assert.deepEqual(reconstructProgress([entry]), steps);
      assert.ok(entry.type === "message");
      assert.deepEqual(entry.message.role === "toolResult" ? entry.message.details : undefined, original);
      const messages = [
        summary,
        progressToolCallMessage([legacyStep(version, text, reason)], toolName(version), argumentKey(version)),
        progressToolResultMessage(original, toolName(version)),
      ];
      const before = JSON.stringify(messages);
      assert.equal(reconcileProgressContext(messages, steps), messages);
      assert.equal(JSON.stringify(messages), before);
    }
    const harness = createHarness();
    const current = createContext({ mode: "print" });
    await harness.emit("session_start", current.ctx);
    try {
      for (const input of [
        [{ text, status: "blocked", reason }],
        steps,
        [{ text: steps[0]?.text, status: "pending" }],
      ]) {
        const assistant = progressToolCallMessage(input);
        assert.ok(assistant.role === "assistant");
        const call = assistant.content.find((part) => part.type === "toolCall");
        assert.ok(call?.type === "toolCall");
        const tool: AgentTool<typeof ProgressParameters> = {
          name: harness.tool.name,
          label: harness.tool.label,
          description: harness.tool.description,
          parameters: ProgressParameters,
          prepareArguments: (args) => harness.tool.prepareArguments(args),
          execute: (id, args, signal) => harness.tool.execute(id, args, signal, undefined, current.ctx),
        };
        const result = await runToolCall(call, {
          tools: [tool],
          assistantMessage: assistant,
          context: { messages: [assistant], tools: [tool] },
        });
        assert.equal(result.isError, false, JSON.stringify(result.result));
        assert.deepEqual(result.result.details, {
          version: 5,
          steps: [{ text: steps[0]?.text, status: input[0]?.status }],
        });
      }
      assert.equal(Compile(ProgressParameters).Check({ steps }), true);
      assert.throws(
        () => prepareProgressArguments({ steps: [{ text: unit.repeat(504), status: "blocked" }] }),
        /exceeds 503/u,
      );
      assert.throws(
        () => prepareProgressArguments({ steps: [{ text: unit.repeat(301), status: "blocked", reason }] }),
        /legacy blocked input/u,
      );
    } finally {
      await harness.emit("session_shutdown", current.ctx);
    }
  });
}

for (const version of versions) {
  test(`v${version} blocked reasons survive restart, forks, compaction, and established boundary reload`, async () => {
    const oldStep = legacyStep(version, "deploy", "approval");
    const steps: ProgressStep[] = [{ text: "deploy — approval", status: "blocked" }];
    const branch: SessionEntry[] = [
      toolResultEntry(legacyDetails(version, [oldStep]), toolName(version), "initial", null),
      {
        type: "compaction",
        id: "compaction",
        parentId: "initial",
        timestamp: new Date(0).toISOString(),
        summary: summary.summary,
        firstKeptEntryId: "kept",
        tokensBefore: 100,
      } as SessionEntry,
    ];
    const current = createContext({ branch });
    const first = createHarness();
    await first.emit("session_start", current.ctx);
    assert.equal(
      current.widgets.at(-1)?.content?.(current.tui, identityTheme().theme).render(80).at(-1),
      "⚠ deploy — approval",
    );
    const generated = await first.context([summary], current.ctx);
    assert.match(String(generated[1]?.role === "custom" ? generated[1].content : ""), /PI PROGRESS STATUS v5/u);
    assert.equal(first.entries.length, 1);
    const oldContent =
      version === 4
        ? `[PI PROGRESS STATUS v4]\nCurrent progress steps as JSON data:\n${JSON.stringify({ steps: [oldStep] })}`
        : `[PI TODO STATUS v3]\nCurrent todo list as JSON data:\n${JSON.stringify({ todos: [oldStep] })}`;
    branch.push(
      customEntry(
        "progress-restored-context-boundary",
        { ...(first.entries[0]?.data as Record<string, unknown>), content: oldContent },
        "boundary",
        "compaction",
      ),
    );
    await first.emit("session_shutdown", current.ctx);
    const reloaded = createHarness();
    await reloaded.emit("session_start", current.ctx);
    try {
      const established = await reloaded.context([summary], current.ctx);
      assert.equal(established[1]?.role === "custom" ? established[1].content : undefined, oldContent);
      assert.equal(reloaded.entries.length, 0);
      await setProgress(reloaded, current.ctx, [{ text: "verify", status: "pending" }]);
      const afterUpdate = await reloaded.context(
        [...established, { role: "user", content: [{ type: "text", text: "continue" }], timestamp: 0 }],
        current.ctx,
      );
      assert.deepEqual(afterUpdate.slice(0, established.length), established);
      await setProgress(reloaded, current.ctx, []);
      assert.equal((await reloaded.context(established, current.ctx))[1]?.role, "custom");
      branch.splice(
        0,
        branch.length,
        toolResultEntry(
          legacyDetails(version, [legacyStep(version, "sibling", "credentials")]),
          toolName(version),
          "sibling",
          null,
        ),
      );
      await reloaded.emit("session_tree", current.ctx);
      const sibling = await reloaded.context([summary], current.ctx);
      const content = sibling[1]?.role === "custom" ? String(sibling[1].content) : "";
      assert.match(content, /PI PROGRESS STATUS v5/u);
      assert.ok(content.endsWith(JSON.stringify({ steps: [{ text: "sibling — credentials", status: "blocked" }] })));
      assert.deepEqual(
        reconcileProgressContext(sibling, [{ text: "sibling — credentials", status: "blocked" }]),
        sibling,
      );
    } finally {
      await reloaded.emit("session_shutdown", current.ctx);
    }
    assert.deepEqual(reconstructProgress([toolResultEntry({ version: 5, steps })]), steps);
  });

  for (const [name, step] of [
    ["missing reason", { [version === 3 ? "step" : "text"]: "bad", status: "blocked" }],
    ["blank reason", legacyStep(version, "bad", " \n ")],
    ["wrong reason type", legacyStep(version, "bad", 1)],
    ["oversized reason", legacyStep(version, "bad", "x".repeat(201))],
    ["oversized text", legacyStep(version, "x".repeat(301), "approval")],
    ["extra field", { ...legacyStep(version, "bad", "approval"), extra: true }],
    ["non-blocked reason", { ...legacyStep(version, "bad", "note"), status: "pending" }],
  ]) {
    test(`v${version} historical ${name} remains invalid`, () => {
      const good = [{ text: "valid", status: "pending" }];
      assert.deepEqual(
        reconstructProgress([
          toolResultEntry({ version: 5, steps: good }),
          toolResultEntry(legacyDetails(version, [step]), toolName(version)),
        ]),
        good,
      );
    });
  }
}

test("v4 raw calls keep only the historical non-blocked tolerance and exact blocker evidence", () => {
  const result = {
    version: 4,
    steps: [
      { text: "done", status: "completed" },
      { text: "deploy", status: "blocked", reason: "approval" },
    ],
  };
  const steps: ProgressStep[] = [
    { text: "done", status: "completed" },
    { text: "deploy — approval", status: "blocked" },
  ];
  const raw = [{ ...result.steps[0], reason: { arbitrary: "ignored" } }, result.steps[1]];
  const messages: ContextEvent["messages"] = [summary, progressToolCallMessage(raw), progressToolResultMessage(result)];
  const before = JSON.stringify(messages);
  assert.equal(reconcileProgressContext(messages, steps), messages);
  assert.equal(JSON.stringify(messages), before);
  for (const invalid of [
    [
      { text: "done", status: "completed" },
      { text: "deploy — approval", status: "blocked" },
    ],
    [
      { text: "done", status: "completed" },
      { text: "deploy", status: "blocked", reason: "credentials" },
    ],
    [{ ...raw[0], extra: true }, raw[1]],
  ]) {
    assert.equal(
      reconcileProgressContext(
        [summary, progressToolCallMessage(invalid), progressToolResultMessage(result)],
        steps,
      ).filter((message) => message.role === "custom").length,
      1,
    );
  }
});

test("new persisted results never normalize reason or silently accept invalid state", () => {
  const good = [{ text: "valid", status: "blocked" }];
  for (const steps of [
    [{ text: "bad", status: "blocked", reason: "approval" }],
    [{ text: "bad", status: "pending", reason: "ignored on calls only" }],
    [{ text: "x".repeat(504), status: "blocked" }],
    [{ text: "bad", status: "unknown" }],
    [{ text: " ", status: "blocked" }],
    [
      { text: "bad", status: "in_progress" },
      { text: "bad", status: "in_progress" },
    ],
  ]) {
    assert.deepEqual(
      reconstructProgress([toolResultEntry({ version: 5, steps: good }), toolResultEntry({ version: 5, steps })]),
      good,
    );
  }
  assert.deepEqual(
    reconstructProgress([toolResultEntry({ version: 5, steps: good }), toolResultEntry({ version: 5, steps: [] })]),
    [],
  );
});

test("merged text is never sanitized, trimmed, deduplicated, or merged a second time", () => {
  const text = "deploy — approval\u202e ";
  const reason = " approval\u001b]8;;x\u0007 ";
  const merged = `${text} — ${reason}`;
  const raw = { steps: [{ text, status: "blocked", reason }] };
  const before = structuredClone(raw);
  const prepared = prepareProgressArguments(raw);
  assert.deepEqual(prepared, { steps: [{ text: merged, status: "blocked" }] });
  assert.deepEqual(raw, before);
  assert.deepEqual(prepareProgressArguments(prepared), prepared);
});
