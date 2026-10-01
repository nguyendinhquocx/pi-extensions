import assert from "node:assert/strict";
import { test } from "vitest";
import { compactionFailureMessage } from "../src/compaction-failure.js";

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
