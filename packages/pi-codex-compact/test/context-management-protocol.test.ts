import assert from "node:assert/strict";
import { test } from "vitest";
import { createContextManagementCollector, validateContextManagementHistory } from "../src/context-management.js";
import { MAX_COMPACTION_ITEM_BYTES } from "../src/protocol.js";

const checkpoint = { type: "compaction", id: "cmp_latest", encrypted_content: "opaque" };
const message = {
  type: "message",
  id: "msg_ok",
  role: "assistant",
  status: "completed",
  content: [{ type: "output_text", text: "OK", annotations: [] }],
};
const reasoning = {
  type: "reasoning",
  id: "rs_ok",
  summary: [{ type: "summary_text", text: "Maintenance" }],
  encrypted_content: "signed-reasoning",
};
const { encrypted_content: _signature, ...unsignedReasoning } = reasoning;
const done = (item: unknown) => ({ type: "response.output_item.done", item });
const completed = (output: unknown[] = []) => ({
  type: "response.completed",
  response: { status: "completed", output },
});
function collect(events: unknown[]) {
  const collector = createContextManagementCollector();
  for (const event of events) collector.observe(event);
  return collector.finish();
}

test("latest completion wins in event order, discarding only items covered by it", () => {
  const first = { ...checkpoint, id: "cmp_first", encrypted_content: "first" };
  assert.deepEqual(collect([done(first), done(message), done(checkpoint), completed()]), [checkpoint]);
  assert.deepEqual(collect([done(checkpoint), done(reasoning), done(message), completed()]), [
    checkpoint,
    reasoning,
    message,
  ]);
  assert.deepEqual(collect([done(checkpoint), completed([checkpoint])]), [checkpoint]);
  assert.deepEqual(collect([done(reasoning), done(checkpoint), completed([reasoning])]), [checkpoint]);
});

test("terminal output reconciles object key order and encrypted reasoning without changing order", () => {
  const canonical = { ...reasoning, encrypted_content: "signed-reasoning" };
  const reordered = {
    content: message.content,
    status: message.status,
    role: message.role,
    id: message.id,
    type: message.type,
  };
  assert.deepEqual(
    collect([done(checkpoint), done(unsignedReasoning), done(message), completed([canonical, reordered])]),
    [checkpoint, canonical, message],
  );
});

for (const [name, events] of [
  ["no checkpoint", [done(message), completed()]],
  ["terminal-only checkpoint", [completed([checkpoint])]],
  ["no successful terminal", [done(checkpoint)]],
  ["invalid terminal", [done(checkpoint), { type: "response.completed", response: {} }]],
  ["incomplete terminal", [done(checkpoint), { type: "response.incomplete" }]],
  ["failed terminal", [done(checkpoint), { type: "response.failed" }]],
  ["error event", [done(checkpoint), { type: "error" }]],
  ["duplicate completion", [done(checkpoint), completed(), completed()]],
  ["item after completion", [done(checkpoint), completed(), done(message)]],
  ["repeated output id", [done(checkpoint), done(checkpoint), completed()]],
  ["conflicting terminal checkpoint", [done(checkpoint), completed([{ ...checkpoint, encrypted_content: "changed" }])]],
  ["unobserved terminal suffix", [done(checkpoint), completed([message])]],
  ["empty opaque value", [done({ type: "compaction", encrypted_content: "" }), completed()]],
  [
    "oversized opaque",
    [done({ ...checkpoint, encrypted_content: "x".repeat(MAX_COMPACTION_ITEM_BYTES) }), completed()],
  ],
  ["non-object item", [done(null), completed()]],
  ["malformed event", [null]],
] as const) {
  test(`fails closed on ${name}`, () => assert.throws(() => collect([...events])));
}

for (const [name, item] of [
  ["function call", { type: "function_call", name: "bash", arguments: "{}" }],
  ["hosted tool call", { type: "web_search_call", status: "completed" }],
  ["unknown output", { type: "new_item" }],
  ["user message", { ...message, role: "user" }],
  ["incomplete message", { ...message, status: "incomplete" }],
  ["malformed text", { ...message, content: [{ type: "output_text", text: 3 }] }],
  ["missing reasoning summary", { type: "reasoning" }],
  ["invalid reasoning signature", { ...reasoning, encrypted_content: {} }],
  [
    "oversized message",
    { ...message, content: [{ type: "output_text", text: "x".repeat(MAX_COMPACTION_ITEM_BYTES) }] },
  ],
] as const) {
  test(`rejects ${name} even if a later checkpoint would hide it`, () => {
    assert.throws(() => collect([done(item), done(checkpoint), completed()]));
    assert.throws(() => validateContextManagementHistory([checkpoint, item], { byteBudget: 8 * 1024 * 1024 }));
  });
}

test("replacement bounds fail rather than silently losing a post-checkpoint suffix", () => {
  const history = [checkpoint, reasoning, message];
  assert.deepEqual(validateContextManagementHistory(history, { byteBudget: 4096, tokenBudget: 1000 }), history);
  assert.throws(() => validateContextManagementHistory(history, { byteBudget: 10 }));
  assert.throws(() => validateContextManagementHistory(history, { byteBudget: 4096, tokenBudget: 1 }));
  assert.throws(() => validateContextManagementHistory([checkpoint, checkpoint], { byteBudget: 4096 }));
  assert.throws(() => validateContextManagementHistory([message, checkpoint], { byteBudget: 4096 }));
  assert.throws(() => validateContextManagementHistory([], { byteBudget: 4096 }));
  const cloned = validateContextManagementHistory(history, { byteBudget: 4096 });
  cloned[0].encrypted_content = "mutated";
  assert.equal(checkpoint.encrypted_content, "opaque");
});

for (const type of ["response.completed", "response.done"]) {
  test(`${type} validates the successful terminal alias`, () => {
    const terminal = { ...completed([reasoning, message]), type };
    assert.deepEqual(collect([done(checkpoint), done(reasoning), done(message), terminal]), [
      checkpoint,
      reasoning,
      message,
    ]);
    assert.throws(() => collect([done(checkpoint), { ...terminal, response: {} }]));
    assert.throws(() => collect([done(checkpoint), { ...terminal, response: { status: "completed" } }]));
    assert.throws(() =>
      collect([done(checkpoint), { ...terminal, response: { status: "completed", output: [message] } }]),
    );
    assert.throws(() =>
      collect([
        done(checkpoint),
        { ...terminal, response: { status: "completed", output: [{ ...checkpoint, encrypted_content: "changed" }] } },
      ]),
    );
    assert.throws(() => collect([done(checkpoint), { ...completed(), type }, completed()]));
    assert.throws(() => collect([done(checkpoint), completed(), { ...completed(), type }]));
    assert.throws(() => collect([done(checkpoint), { ...completed(), type }, done(message)]));
  });

  for (const status of [undefined, null, "incomplete", "failed", "cancelled", "queued", "in_progress", "unknown"]) {
    test(`${type} rejects unsuccessful or missing status ${String(status)}`, () => {
      assert.throws(() => collect([done(checkpoint), { type, response: { status, output: [] } }]));
    });
  }

  for (const signature of [undefined, null, ""]) {
    const pending = signature === undefined ? unsignedReasoning : { ...reasoning, encrypted_content: signature };
    test(`${type} backfills ${String(signature)} reasoning encryption before publication`, () => {
      assert.deepEqual(collect([done(checkpoint), done(pending), { ...completed([reasoning]), type }]), [
        checkpoint,
        reasoning,
      ]);
      assert.deepEqual(collect([done(pending), done(checkpoint), { ...completed([pending]), type }]), [checkpoint]);
    });
    test(`${type} never publishes or restores unresolved ${String(signature)} reasoning`, () => {
      assert.throws(() => collect([done(checkpoint), done(pending), { ...completed(), type }]));
      assert.throws(() => collect([done(checkpoint), done(pending), { ...completed([pending]), type }]));
      assert.throws(() => validateContextManagementHistory([checkpoint, pending], { byteBudget: 4096 }));
    });
  }
}

test("non-empty completed reasoning cannot be replaced by conflicting terminal encryption", () => {
  assert.throws(() =>
    collect([done(checkpoint), done(reasoning), completed([{ ...reasoning, encrypted_content: "different" }])]),
  );
  assert.throws(() =>
    collect([done(checkpoint), done(reasoning), completed([{ ...reasoning, encrypted_content: null }])]),
  );
});

test("a checkpoint marked incomplete is never published or restored", () => {
  const incomplete = { ...checkpoint, status: "incomplete" };
  assert.throws(() => collect([done(incomplete), completed()]));
  assert.throws(() => validateContextManagementHistory([incomplete], { byteBudget: 4096 }));
});

test("completed refusals remain inert and replayable", () => {
  const refusal = { ...message, content: [{ type: "refusal", refusal: "Unavailable" }] };
  assert.deepEqual(collect([done(checkpoint), done(refusal), completed([refusal])]), [checkpoint, refusal]);
});
