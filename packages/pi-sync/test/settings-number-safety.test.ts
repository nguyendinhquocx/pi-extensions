import assert from "node:assert/strict";
import { test } from "vitest";
import { parseSettingsDocument } from "../src/sync/json-document.js";
import { overlayLocalFields, portableSnapshot, validatePortableSnapshot } from "../src/sync/local-fields.js";
import { mergeSettingsJson } from "../src/sync/settings-merge.js";
import { snapshot } from "./helpers.js";

const image = (text: string) => snapshot([{ path: "settings.json", content: Buffer.from(text) }]);

for (const token of [
  "9007199254740992",
  "9007199254740993",
  "-9007199254740993",
  "9.007199254740993e15",
  "1e400",
  "1e-400",
  "0.10000000000000001",
]) {
  for (const value of [token, `{"nested":[${token}]}`]) {
    test(`unsafe numeric source requires review: ${value}`, () => {
      const content = `{"value":${value},"machine":"private-value"}`;
      assert.throws(() => parseSettingsDocument(Buffer.from(content)), /Unsupported settings JSON/);
      assert.throws(() => portableSnapshot(image(content), ["machine"]), /Unsupported settings JSON/);
      assert.throws(
        () => overlayLocalFields(image('{"value":0}'), image(content), ["machine"]),
        /Unsupported settings JSON/,
      );
      assert.throws(
        () => validatePortableSnapshot({ ...image(`{"value":${value}}`), version: 2, localFields: ["machine"] }),
        /unsupported document/,
      );
      assert.deepEqual(
        mergeSettingsJson(
          Buffer.from('{"value":0}'),
          Buffer.from(content),
          Buffer.from('{"value":0,"theme":"remote"}'),
        ),
        { kind: "review", reason: "unsupported-format", fields: [] },
      );
    });
  }
}

test("distinct rounded integers never discard a local edit", () => {
  const result = mergeSettingsJson(
    Buffer.from('{"value":9007199254740992,"theme":"base"}'),
    Buffer.from('{"value":9007199254740993,"theme":"base"}'),
    Buffer.from('{"value":9007199254740992,"theme":"remote"}'),
  );
  assert.deepEqual(result, { kind: "review", reason: "unsupported-format", fields: [] });
});

for (const token of ["9007199254740991", "-9007199254740991", "0", "-0", "1.0", "1e0", "0.1", "1.25e-3", "1e-300"]) {
  test(`supported numeric source retains its spelling: ${token}`, () => {
    const content = Buffer.from(`{"value":${token}}`);
    const result = mergeSettingsJson(content, content, Buffer.from(`{"value":${token},"theme":"remote"}`));
    assert.equal(result.kind, "merged");
    if (result.kind === "merged") {
      assert.match(result.content.toString(), new RegExp(`"value":${token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
      assert.equal(JSON.parse(result.content.toString()).theme, "remote");
    }
  });
}
