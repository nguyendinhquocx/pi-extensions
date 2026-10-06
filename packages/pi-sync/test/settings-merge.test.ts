import assert from "node:assert/strict";
import { test } from "vitest";
import { mergeSettingsJson } from "../src/sync/settings-merge.js";

const bytes = (value: unknown) => Buffer.from(JSON.stringify(value));
for (const [name, base, local, remote, expected] of [
  [
    "independent theme/model",
    { theme: "light", defaultModel: "old" },
    { theme: "dark", defaultModel: "old" },
    { theme: "light", defaultModel: "new" },
    { theme: "dark", defaultModel: "new" },
  ],
  ["equal edits", { x: 1 }, { x: 2 }, { x: 2 }, { x: 2 }],
  ["unknown addition and deletion", { old: 1 }, {}, { old: 1, future: null }, { future: null }],
  ["null is not absent", {}, { x: null }, {}, { x: null }],
  ["atomic array unilateral", { x: [1] }, { x: [1, 2] }, { x: [1], y: 2 }, { x: [1, 2], y: 2 }],
  [
    "unilateral analytics opt-in keeps its tracking ID",
    { enableAnalytics: false, trackingId: "old", theme: "light" },
    { enableAnalytics: true, trackingId: "new", theme: "light" },
    { enableAnalytics: false, trackingId: "old", theme: "dark" },
    { enableAnalytics: true, trackingId: "new", theme: "dark" },
  ],
  ["atomic object unilateral", { x: { a: 1 } }, { x: { a: 2 } }, { x: { a: 1 }, y: true }, { x: { a: 2 }, y: true }],
] as const) {
  test(`settings merge: ${name}`, () => {
    const result = mergeSettingsJson(bytes(base), bytes(local), bytes(remote));
    assert.equal(result.kind, "merged");
    if (result.kind === "merged") assert.deepEqual(JSON.parse(result.content.toString()), expected);
  });
}
for (const [name, base, local, remote] of [
  ["divergent field", { x: 1 }, { x: 2 }, { x: 3 }],
  ["different concurrent addition", {}, { x: null }, { x: false }],
  ["delete/modify", { x: 1 }, {}, { x: 2 }],
  ["incompatible types", { x: 1 }, { x: [] }, { x: {} }],
  ["array union refused", { x: [1] }, { x: [1, 2] }, { x: [1, 3] }],
  ["nested objects conservative", { x: { a: 1, b: 1 } }, { x: { a: 2, b: 1 } }, { x: { a: 1, b: 2 } }],
  [
    "analytics opt-in and tracking ID must stay coupled",
    { enableAnalytics: false, trackingId: "old" },
    { enableAnalytics: true, trackingId: "old" },
    { enableAnalytics: false },
  ],
  [
    "coupled provider/model",
    { defaultProvider: "p", defaultModel: "m" },
    { defaultProvider: "q", defaultModel: "m" },
    { defaultProvider: "p", defaultModel: "n" },
  ],
] as const) {
  test(`settings conflict: ${name}`, () => {
    const result = mergeSettingsJson(bytes(base), bytes(local), bytes(remote));
    assert.equal(result.kind, "review");
    if (result.kind === "review") assert.equal(result.reason, "field-conflict");
  });
}
for (const text of [
  '{"x":1,"x":2}',
  '{"x":{"nested":1,"nested":2}}',
  '{"__proto__":{}}',
  '{"x":{"constructor":1}}',
  '{/*comment*/"x":1}',
  '{"x":1,}',
  "[]",
  '{"queueMode":"all"}',
  '{"websockets":true}',
  '{"skills":{"customDirectories":["private"]}}',
  '{"retry":{"maxDelayMs":123}}',
]) {
  test(`unsupported settings format: ${text}`, () => {
    assert.deepEqual(mergeSettingsJson(Buffer.from(text), bytes({}), bytes({})), {
      kind: "review",
      reason: "unsupported-format",
      fields: [],
    });
  });
}
test("preserves BOM, CRLF, unaffected member spelling, and numeric spelling", () => {
  const local = Buffer.from('\uFEFF{\r\n    "theme" : "dark",\r\n    "number": 1.00e0\r\n}\r\n');
  const result = mergeSettingsJson(
    bytes({ theme: "light", number: 1 }),
    local,
    bytes({ theme: "light", number: 1, future: true }),
  );
  assert.equal(result.kind, "merged");
  if (result.kind === "merged") {
    assert.equal(
      result.content.toString(),
      '\uFEFF{\r\n    "theme" : "dark",\r\n    "number": 1.00e0,\r\n    "future": true\r\n}\r\n',
    );
  }
});
test("invalid UTF-8 and oversized input withhold merge without parser payload disclosure", () => {
  for (const input of [Buffer.from([0x7b, 0x22, 0xff, 0x22, 0x3a, 0x31, 0x7d]), Buffer.alloc(1024 * 1024 + 1)]) {
    assert.deepEqual(mergeSettingsJson(input, bytes({}), bytes({})), {
      kind: "review",
      reason: "unsupported-format",
      fields: [],
    });
  }
});
