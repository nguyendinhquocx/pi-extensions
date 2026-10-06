import assert from "node:assert/strict";
import { test } from "vitest";
import { compactionFailureMessage, inspectFailureResponse, observeSseRejections } from "../src/compaction-failure.js";

const rejection = { code: "hardened_oauth_rule_missing", type: "rejected_by_hardened_oauth_boundary" };

for (const body of [rejection, { error: rejection }]) {
  test(`recognizes the exact structured rejection in ${JSON.stringify(body)}`, () => {
    const message = compactionFailureMessage(new Error(`OpenAI API error (401): ${JSON.stringify(body)}`));
    assert.match(message, /ChatGPT OAuth is not authorized for this compaction operation/);
    assert.match(message, /hardened_oauth_rule_missing/);
    assert.match(message, /rejected_by_hardened_oauth_boundary/);
  });
}

for (const error of [
  null,
  undefined,
  "HTTP 401: unauthorized",
  new Error("malformed {"),
  new Error(JSON.stringify({ error: null })),
  new Error(JSON.stringify({ error: "hardened_oauth_rule_missing" })),
  new Error(JSON.stringify({ message: rejection })),
  new Error(JSON.stringify({ ...rejection, code: `${rejection.code}_extra` })),
  new Error(JSON.stringify({ ...rejection, type: `${rejection.type}_extra` })),
]) {
  test(`preserves generic fallback for ${String(error)}`, () => {
    const message = compactionFailureMessage(error);
    assert.match(message, /^Responses compaction failed; using Pi compaction\./);
    assert.doesNotMatch(message, /ChatGPT OAuth is not authorized/);
  });
}

test("redacts literal, JSON-escaped, overlapping, and header-owned request credentials", () => {
  const secret = 'fixture-"secret\\with\ncontrols';
  const raw = `echo ${secret} and ${JSON.stringify(secret)} and header-token and Bearer header-token\u001b[31m`;
  const message = compactionFailureMessage(new Error(raw), ["", secret, "Bearer header-token", "header-token"]);
  assert.doesNotMatch(message, /fixture-|header-token/);
  assert.equal(
    [...message].every((char) => char.charCodeAt(0) >= 32 && !(char.charCodeAt(0) >= 127 && char.charCodeAt(0) <= 159)),
    true,
  );
  assert.match(message, /\[redacted\]/);
  assert.equal(raw.includes(secret), true, "raw diagnostics remain unchanged");
});

test("header-owned Basic credentials are redacted even when echoed without their scheme", () => {
  const message = compactionFailureMessage(new Error("HTTP 401: rejected basic-credential"), [
    "Basic basic-credential",
  ]);
  assert.equal(message, "Responses compaction failed; using Pi compaction. HTTP 401: rejected [redacted]");
});

test("generic provider failures also redact known request values without changing their classification", () => {
  const message = compactionFailureMessage(new Error("HTTP 403: secret-api-key is not allowed"), ["secret-api-key"]);
  assert.equal(message, "Responses compaction failed; using Pi compaction. HTTP 403: [redacted] is not allowed");
});

test("failed HTTP response inspection is bounded, preserves unrelated bodies, and ignores successful output", async () => {
  const signal = new AbortController().signal;
  const response = Response.json(
    { error: { code: "hardened_oauth_rule_missing", type: "rejected_by_hardened_oauth_boundary" } },
    { status: 403 },
  );
  const inspected = await inspectFailureResponse(response, signal);
  assert.ok(inspected.rejection);
  assert.equal(inspected.response.status, 403);
  assert.match(await inspected.response.text(), /hardened_oauth_rule_missing/);
  for (const body of [
    "unauthorized",
    "{invalid",
    JSON.stringify({ message: "hardened_oauth_rule_missing rejected_by_hardened_oauth_boundary" }),
  ]) {
    const result = await inspectFailureResponse(new Response(body, { status: 401 }), signal);
    assert.equal(result.rejection, undefined);
    assert.equal(await result.response.text(), body);
  }
  const success = new Response("must not be read");
  assert.equal((await inspectFailureResponse(success, signal)).response, success);
  assert.equal(success.bodyUsed, false);
  let released = false;
  const oversized = new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(65537));
      },
      cancel() {
        released = true;
      },
    }),
    { status: 401 },
  );
  await assert.rejects(inspectFailureResponse(oversized, signal), /64 KiB/);
  assert.equal(released, true);
});

test("failed HTTP inspection releases a hanging response on cancellation", async () => {
  const controller = new AbortController();
  let released = false;
  const response = new Response(
    new ReadableStream({
      cancel() {
        released = true;
      },
    }),
    { status: 401 },
  );
  const pending = inspectFailureResponse(response, controller.signal);
  controller.abort();
  await assert.rejects(pending, /aborted/i);
  assert.equal(released, true);
});

test("SSE error inspection preserves bytes, handles CRLF and split UTF-8, and ignores quoted/malformed/incomplete records", async () => {
  const error = { code: "hardened_oauth_rule_missing", type: "rejected_by_hardened_oauth_boundary", message: "拒絕" };
  const fixtures = [
    [`data: ${JSON.stringify({ type: "error", error })}\r\n\r\n`, 1],
    [`event: error\r\ndata: {"error":\r\ndata: ${JSON.stringify(error)}}\r\n\r\n`, 1],
    [`data: ${JSON.stringify({ type: "response.output_text.delta", delta: JSON.stringify(error) })}\n\n`, 0],
    [`data: ${JSON.stringify({ type: "error", error })}`, 0],
    ["data: {invalid}\n\n", 0],
  ] as const;
  for (const [data, expected] of fixtures) {
    const encoded = new TextEncoder().encode(data);
    const response = new Response(
      new ReadableStream({
        start(controller) {
          for (let offset = 0; offset < encoded.length; offset += 7)
            controller.enqueue(encoded.slice(offset, offset + 7));
          controller.close();
        },
      }),
    );
    let count = 0;
    const observed = observeSseRejections(response, new AbortController().signal, () => {
      count += 1;
    });
    assert.deepEqual(new Uint8Array(await observed.arrayBuffer()), encoded);
    assert.equal(count, expected);
  }
});
