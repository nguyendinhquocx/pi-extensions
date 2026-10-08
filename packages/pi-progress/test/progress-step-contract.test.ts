import assert from "node:assert/strict";
import { type AgentTool, runToolCall } from "@earendil-works/pi-agent-core";
import type { Static } from "typebox";
import { Compile } from "typebox/compile";
import { expectTypeOf, test } from "vitest";
import {
  cloneProgressSteps,
  ProgressParameters,
  type ProgressStep,
  reconcileProgressContext,
  reconstructProgress,
} from "../src/progress-state.js";
import {
  createContext,
  createHarness,
  progressToolCallMessage,
  progressToolResultMessage,
  toolResultEntry,
} from "./progress-harness.js";

const schema = Compile(ProgressParameters);
const canonical: ProgressStep[] = [
  { text: "queued", status: "pending" },
  { text: "working", status: "in_progress" },
  { text: "done", status: "completed" },
  { text: "waiting — needs approval", status: "blocked" },
];

// This also makes the repository's emitted-test typecheck enforce schema/type agreement.
expectTypeOf<Static<typeof ProgressParameters>["steps"][number]>().toEqualTypeOf<ProgressStep>();

const blockedReasons: [string, Record<string, unknown>][] = [
  ["empty", { reason: "" }],
  ["whitespace", { reason: " \n " }],
  ["wrong type", { reason: 1 }],
  ["null", { reason: null }],
  ["overlong", { reason: "x".repeat(201) }],
];

const cases: Array<{ name: string; input: unknown; schemaValid: boolean; prepared: boolean }> = [
  { name: "mixed canonical steps", input: { steps: canonical }, schemaValid: true, prepared: true },
  { name: "clear", input: { steps: [] }, schemaValid: true, prepared: true },
  {
    name: "maximum step count",
    input: { steps: Array.from({ length: 50 }, () => canonical[0]) },
    schemaValid: true,
    prepared: true,
  },
  {
    name: "maximum text length",
    input: { steps: [{ text: "x".repeat(503), status: "blocked" }] },
    schemaValid: true,
    prepared: true,
  },
  ...["pending", "in_progress", "completed"].map((status) => ({
    name: `${status} with redundant reason`,
    input: { steps: [{ text: "work", status, reason: "general note" }] },
    schemaValid: false,
    prepared: true,
  })),
  ...[null, 1, { note: "redundant" }].map((reason) => ({
    name: `non-blocked ignores redundant reason ${JSON.stringify(reason)}`,
    input: { steps: [{ text: "work", status: "pending", reason }] },
    schemaValid: false,
    prepared: true,
  })),
  ...blockedReasons.map(([name, fields]) => ({
    name: `blocked reason ${name}`,
    input: { steps: [{ text: "work", status: "blocked", ...fields }] },
    schemaValid: false,
    prepared: false,
  })),
  {
    name: "unknown status",
    input: { steps: [{ text: "work", status: "unknown", reason: "note" }] },
    schemaValid: false,
    prepared: false,
  },
  {
    name: "unknown field with redundant reason",
    input: { steps: [{ text: "work", status: "pending", reason: "note", extra: true }] },
    schemaValid: false,
    prepared: false,
  },
  { name: "unknown top-level field", input: { steps: [], extra: true }, schemaValid: false, prepared: false },
  {
    name: "too many steps",
    input: { steps: Array.from({ length: 51 }, () => canonical[0]) },
    schemaValid: false,
    prepared: false,
  },
  {
    name: "text too long",
    input: { steps: [{ text: "x".repeat(504), status: "pending" }] },
    schemaValid: true,
    prepared: false,
  },
  { name: "blank text", input: { steps: [{ text: " ", status: "pending" }] }, schemaValid: true, prepared: false },
  { name: "multiple active steps", input: { steps: [canonical[1], canonical[1]] }, schemaValid: true, prepared: false },
  {
    name: "grapheme-aware runtime limit",
    input: { steps: [{ text: "e\u0301".repeat(252), status: "pending" }] },
    schemaValid: true,
    prepared: true,
  },
  { name: "non-array steps", input: { steps: "work" }, schemaValid: false, prepared: false },
  { name: "non-object step", input: { steps: [null] }, schemaValid: false, prepared: false },
];

for (const { name, input, schemaValid, prepared } of cases) {
  test(`step contract: ${name}`, () => {
    const { tool } = createHarness();
    const before = structuredClone(input);
    assert.equal(schema.Check(input), schemaValid);
    if (prepared) tool.prepareArguments(input);
    else assert.throws(() => tool.prepareArguments(input), /Progress update rejected/u);
    assert.deepEqual(input, before, "preparation must not mutate model input");
  });
}

async function runProgressCall(
  harness: ReturnType<typeof createHarness>,
  ctx: ReturnType<typeof createContext>["ctx"],
  steps: unknown,
) {
  const assistant = progressToolCallMessage(steps);
  assert.ok(assistant.role === "assistant");
  const message = assistant;
  const call = message.content.find((part) => part.type === "toolCall");
  assert.ok(call?.type === "toolCall");
  const tool: AgentTool<typeof ProgressParameters> = {
    name: harness.tool.name,
    label: harness.tool.label,
    description: harness.tool.description,
    parameters: ProgressParameters,
    prepareArguments: (args) => harness.tool.prepareArguments(args),
    execute: (id, args, signal) => harness.tool.execute(id, args, signal, undefined, ctx),
  };
  return runToolCall(call, {
    tools: [tool],
    assistantMessage: message,
    context: { messages: [message], tools: [tool] },
  });
}

for (const mode of ["tui", "rpc", "print", "json"] as const) {
  test(`Pi prepares before schema validation and preserves state after rejection in ${mode}`, async () => {
    const harness = createHarness();
    const current = createContext({ mode });
    await harness.emit("session_start", current.ctx);
    try {
      const raw = canonical.map((step) =>
        step.status === "blocked"
          ? { text: "waiting", status: "blocked", reason: "needs approval" }
          : { ...step, reason: "note" },
      );
      const before = structuredClone(raw);
      const updated = await runProgressCall(harness, current.ctx, raw);
      assert.equal(updated.isError, false);
      assert.deepEqual(updated.result.details, { version: 5, steps: canonical });
      assert.deepEqual(raw, before);
      assert.deepEqual(cloneProgressSteps(canonical), canonical);
      assert.equal(
        current.widgets.some((widget) => typeof widget.content === "function" || Array.isArray(widget.lines)),
        mode === "tui" || mode === "rpc",
      );
      const publicationCount = current.widgets.length;
      const invalid = await runProgressCall(harness, current.ctx, [{ text: "wait", status: "blocked", extra: true }]);
      assert.equal(invalid.isError, true);
      assert.equal(current.widgets.length, publicationCount);
      const summary = { role: "compactionSummary", summary: "Earlier work", tokensBefore: 100, timestamp: 0 } as const;
      const restored = await harness.context([summary], current.ctx);
      const state = restored.find((message) => message.role === "custom");
      assert.ok(state?.role === "custom");
      assert.equal(String(state.content).endsWith(JSON.stringify({ steps: canonical })), true);
      const cleared = await runProgressCall(harness, current.ctx, []);
      assert.equal(cleared.isError, false);
      assert.deepEqual(cleared.result.details, { version: 5, steps: [] });
    } finally {
      await harness.emit("session_shutdown", current.ctx);
    }
  });
}

test("retained normalized calls suppress redundant compaction context without repairing invalid results", () => {
  const summary = { role: "compactionSummary", summary: "Earlier work", tokensBefore: 100, timestamp: 0 } as const;
  const raw = canonical.map((step) => (step.status === "blocked" ? step : { ...step, reason: "note" }));
  const messages = [summary, progressToolCallMessage(raw), progressToolResultMessage({ version: 5, steps: canonical })];
  assert.equal(reconcileProgressContext(messages, canonical), messages);
  assert.deepEqual(
    reconstructProgress([
      toolResultEntry({ version: 5, steps: canonical }),
      toolResultEntry({ version: 5, steps: raw }, undefined, "invalid"),
    ]),
    canonical,
  );
  for (const invalid of [
    [{ text: "queued", status: "pending", reason: "note", extra: true }],
    [{ text: "waiting", status: "blocked" }],
    [{ text: "queued", status: "unknown", reason: "note" }],
  ]) {
    const badCall = [
      summary,
      progressToolCallMessage(invalid),
      progressToolResultMessage({ version: 5, steps: canonical }),
    ];
    assert.equal(reconcileProgressContext(badCall, canonical).filter((message) => message.role === "custom").length, 1);
  }
});
