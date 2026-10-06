import assert from "node:assert/strict";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { test } from "vitest";
import { mergeSession, validateSession } from "../src/sync/session-merge.js";
import { isMergeTextPath, mergeText } from "../src/sync/text-merge.js";

const b = (value: string) => Buffer.from(value);
for (const [name, base, local, remote, expected] of [
  ["independent", "a\nb\nc\n", "A\nb\nc\n", "a\nb\nC\n", "A\nb\nC\n"],
  ["same edit", "a\nb\n", "A\nb\n", "A\nb\n", "A\nb\n"],
  ["disjoint deletions", "a\nb\nc\nd\n", "b\nc\nd\n", "a\nb\nc\n", "b\nc\n"],
  ["CRLF", "a\r\nb\r\nc\r\n", "A\r\nb\r\nc\r\n", "a\r\nb\r\nC\r\n", "A\r\nb\r\nC\r\n"],
  ["trailing", "a\nb\nc", "A\nb\nc", "a\nb\nC", "A\nb\nC"],
  ["overlap", "a\nb\n", "A\nb\n", "X\nb\n", undefined],
  ["same insertion point", "a\nb\n", "a\nL\nb\n", "a\nR\nb\n", undefined],
  ["delete modify", "a\nb\n", "a\n", "a\nB\n", undefined],
] as const)
  test(`text ${name}`, () => assert.equal(mergeText(b(base), b(local), b(remote))?.toString(), expected));
test("binary, invalid UTF-8, complexity and size bounds withhold merge", () => {
  assert.equal(mergeText(b("a"), Buffer.from([255]), b("b")), undefined);
  assert.equal(mergeText(b("a"), b("a\u0000"), b("b")), undefined);
  assert.equal(mergeText(b("a"), b("x".repeat(1024 * 1024 + 1)), b("b")), undefined);
  assert.equal(mergeText(b("x\n".repeat(2500)), b("a\n".repeat(2500)), b("b\n")), undefined);
  assert.equal(isMergeTextPath("keybindings.json"), false);
  assert.equal(isMergeTextPath("extensions/runtime.ts"), false);
});
const header = { type: "session", version: 3, id: "session-one", cwd: "/tmp", timestamp: "2026-10-05T00:00:00Z" };
const entry = (id: string, parentId: string | null) => ({
  type: "message",
  id,
  parentId,
  timestamp: header.timestamp,
  message: { role: "user", content: "hello", timestamp: 1 },
});
const log = (...rows: unknown[]) => b(`${rows.map((row) => JSON.stringify(row)).join("\n")}\n`);
const base = log(header, entry("root", null));
const longer = log(header, entry("root", null), entry("next", "root"));
const longest = log(header, entry("root", null), entry("next", "root"), entry("last", "next"));
test("sessions accept only comparable complete byte-prefix histories", () => {
  assert.deepEqual(mergeSession(base, longer, longest), longest);
  assert.deepEqual(mergeSession(base, longest, longer), longest);
  assert.equal(mergeSession(base, longer, log(header, entry("root", null), entry("other", "root"))), undefined);
});
for (const [name, bytes] of [
  ["partial", longer.subarray(0, longer.length - 1)],
  ["malformed tail", Buffer.concat([base, b("broken\n")])],
  ["blank", Buffer.concat([base, b("\n")])],
  [
    "duplicate JSON key",
    Buffer.concat([
      base,
      b(
        '{"type":"message","id":"a","id":"b","parentId":"root","timestamp":"now","message":{"role":"user","content":"secret","timestamp":1}}\n',
      ),
    ]),
  ],
  ["record BOM", Buffer.concat([base, b(`\uFEFF${JSON.stringify(entry("new", "root"))}\n`)])],
  ["old version", log({ ...header, version: 2 }, entry("root", null))],
  ["future version", log({ ...header, version: 4 }, entry("root", null))],
  ["duplicate", log(header, entry("root", null), entry("root", "root"))],
  ["missing parent", log(header, entry("root", null), entry("next", "missing"))],
  ["unknown kind", log(header, { ...entry("root", null), type: "future" })],
] as const)
  test(`session refuses ${name}`, () => {
    if (name === "duplicate JSON key") assert.throws(() => validateSession(bytes), /Unsupported JSON object/);
    else assert.throws(() => validateSession(bytes));
    assert.equal(mergeSession(base, longer, bytes), undefined);
  });
test("identity or immutable prefix change never joins sessions", () => {
  assert.equal(mergeSession(base, longer, log({ ...header, id: "other" }, entry("root", null))), undefined);
  assert.equal(mergeSession(base, longer, log({ ...header, cwd: "/changed" }, entry("root", null))), undefined);
});

test("public Pi writer produces accepted system, retain-none compaction and re-edit roots", () => {
  const manager = SessionManager.inMemory("/tmp");
  manager.appendMessage({
    role: "system",
    content: "base instructions",
    sections: { resources: "tail" },
    timestamp: 1,
  });
  manager.appendMessage({ role: "user", content: "hello", timestamp: 2 });
  const before = log(manager.getHeader(), ...manager.getEntries());
  manager.appendCompaction("summary", null, 42);
  const compacted = log(manager.getHeader(), ...manager.getEntries());
  manager.resetLeaf();
  manager.appendMessage({ role: "user", content: "re-edit", timestamp: 3 });
  manager.branchWithSummary(null, "abandoned");
  const extended = log(manager.getHeader(), ...manager.getEntries());
  assert.equal(validateSession(before), manager.getSessionId());
  assert.equal(validateSession(compacted), manager.getSessionId());
  assert.equal(validateSession(extended), manager.getSessionId());
  assert.deepEqual(mergeSession(before, compacted, extended), extended);
  assert.equal(
    mergeSession(
      before,
      compacted,
      log(
        manager.getHeader(),
        ...manager.getEntries().slice(0, 2),
        entry("diverged", manager.getEntries()[1]?.id ?? null),
      ),
    ),
    undefined,
  );
});

for (const identity of ["a", "0", "team.alpha", "a.b-_.9", "a".repeat(512)])
  test(`public session header ID grammar accepts ${identity.length > 32 ? "long ID" : identity}`, () => {
    const manager = SessionManager.inMemory("/tmp", { id: identity });
    manager.appendMessage({ role: "user", content: "base", timestamp: 1 });
    const baseline = log(manager.getHeader(), ...manager.getEntries());
    manager.appendMessage({ role: "user", content: "suffix", timestamp: 2 });
    const extended = log(manager.getHeader(), ...manager.getEntries());
    assert.equal(validateSession(baseline), identity);
    assert.deepEqual(mergeSession(baseline, baseline, extended), extended);
  });
for (const identity of [
  "",
  ".alpha",
  "alpha.",
  "_alpha",
  "alpha_",
  "-alpha",
  "alpha-",
  "a/b",
  "a\\b",
  "a b",
  "é",
  "a\n",
])
  test(`public session header ID grammar refuses ${JSON.stringify(identity)}`, () => {
    assert.throws(() => SessionManager.inMemory("/tmp", { id: identity }));
    const invalid = log({ ...header, id: identity }, entry("root", null));
    assert.throws(() => validateSession(invalid));
    assert.equal(mergeSession(base, base, invalid), undefined);
  });

const system = {
  role: "system",
  content: [{ type: "text", text: "instructions" }],
  timestamp: 1,
  sections: { resources: "new", removed: null },
  toolsAdded: [{ name: "read", description: "Read", parameters: { type: "object", properties: {} } }],
  toolsRemoved: [{ name: "old" }],
};
for (const [name, payload] of [
  ["system tool transition", system],
  ["user image", { role: "user", content: [{ type: "image", data: "AA==", mimeType: "image/png" }], timestamp: 1 }],
  ...["pending", "stop", "length", "toolUse", "error", "aborted", "deferred"].map((stopReason) => [
    `assistant ${stopReason}`,
    {
      role: "assistant",
      content: [
        { type: "thinking", thinking: "reason" },
        { type: "toolCall", id: "call/with:provider|suffix", name: "read", arguments: {} },
      ],
      api: "test",
      provider: "test",
      model: "test",
      usage: {},
      stopReason,
      timestamp: 1,
    },
  ]),
  [
    "tool result",
    {
      role: "toolResult",
      toolCallId: "call/with:provider|suffix",
      toolName: "read",
      content: [{ type: "text", text: "ok" }],
      isError: false,
      timestamp: 1,
    },
  ],
  ["custom", { role: "custom", customType: "test", content: "text", display: false, timestamp: 1 }],
  ["bash", { role: "bashExecution", command: "true", output: "", cancelled: false, truncated: false, timestamp: 1 }],
  ["branch summary", { role: "branchSummary", summary: "summary", fromId: null, timestamp: 1 }],
  ["compaction summary", { role: "compactionSummary", summary: "summary", tokensBefore: 1, timestamp: 1 }],
] as const)
  test(`builtin session message ${name}`, () => {
    const extended = log(header, entry("root", null), { ...entry("next", "root"), message: payload });
    assert.deepEqual(mergeSession(base, base, extended), extended);
  });
for (const [name, payload] of [
  ["thinking_level_change", { thinkingLevel: "high" }],
  ["model_change", { provider: "test", modelId: "test" }],
  ["usage", { kind: "cache_warm", provider: "test", model: "test", usage: {} }],
  ["compaction", { summary: "summary", firstKeptEntryId: "next", tokensBefore: 1, systemMessage: system }],
  ["branch_summary", { summary: "summary", fromId: "root" }],
  ["custom", { customType: "test", data: { preserved: true } }],
  ["custom_message", { customType: "test", content: "text", display: false }],
  ["context_edit", { targetId: "root", replacement: { content: "replacement" } }],
  ["label", { targetId: "root", label: "label" }],
  ["session_info", { name: "name" }],
] as const)
  test(`builtin session entry ${name}`, () => {
    const extended = log(header, entry("root", null), {
      type: name,
      id: "next",
      parentId: "root",
      timestamp: header.timestamp,
      ...payload,
    });
    assert.deepEqual(mergeSession(base, base, extended), extended);
  });
for (const payload of [
  { type: "compaction", summary: "summary", firstKeptEntryId: "future", tokensBefore: 1 },
  {
    type: "compaction",
    summary: "summary",
    firstKeptEntryId: "next",
    tokensBefore: 1,
    systemMessage: { ...system, sections: [] },
  },
  { type: "message", message: { ...system, content: [{ type: "image", data: "AA==", mimeType: "image/png" }] } },
  { type: "message", message: { ...system, toolsRemoved: [{ name: 1 }] } },
  { type: "message", message: { ...system, toolsAdded: [{ name: "broken" }] } },
  { type: "message", message: { ...system, sections: { bad: 1 } } },
  { type: "context_edit", targetId: "future", replacement: null },
])
  test(`malformed builtin payload stays withheld: ${JSON.stringify(payload)}`, () => {
    const extended = log(header, entry("root", null), {
      id: "next",
      parentId: "root",
      timestamp: header.timestamp,
      ...payload,
    });
    assert.throws(() => validateSession(extended));
    assert.equal(mergeSession(base, base, extended), undefined);
  });
