import assert from "node:assert/strict";
import { test, vi } from "vitest";
import type { ConflictArtifact } from "../src/sync/conflict-artifacts.js";
import { CONFLICT_DISPLAY_BYTES, conflictPreview } from "../src/sync/conflict-preview.js";
import { snapshotFile } from "../src/sync/content-conflicts.js";
import { snapshot } from "./helpers.js";

function artifact(count = 1): ConflictArtifact {
  const local = snapshot(
    Array.from({ length: count }, (_, index) => ({
      path: `prompts/${index}.md`,
      content: Buffer.from(`  exact ${index}\n`),
    })),
  );
  return {
    version: 1,
    identity: "test",
    state: { version: 1, profile: "test", lastFileHashes: {} },
    local,
    remote: structuredClone(local),
    groups: [],
    observed: { snapshotId: "test", revision: "test" },
  };
}
test("indexed exact review retains absent/unavailable ancestors, binary evidence, BOM and control sanitation", () => {
  const input = artifact();
  input.state.lastFileHashes = { "prompts/0.md": "a".repeat(64) };
  input.local.files = [snapshotFile("prompts/0.md", Buffer.from("\uFEFF  exact\r\n\u001b[31mraw\n"))];
  input.remote.files = [snapshotFile("prompts/0.md", Buffer.from([255, 0]))];
  const original = JSON.stringify(input);
  const result = conflictPreview(input, ["prompts/0.md", "prompts/absent.md"], "store\u001bpath");
  assert.match(result, /verified ancestor unavailable; sha256/);
  assert.match(result, /\? {2}exact\?\n\?\[31mraw/);
  assert.match(result, /base64: \/wA=/);
  assert.match(result, /\(absent\)/);
  assert.equal(result.includes("\u001b"), false);
  assert.equal(JSON.stringify(input), original);
});
test("many-path review indexes versions without Array.find or repeated ancestor searches", () => {
  const input = artifact(1000);
  const find = vi.spyOn(Array.prototype, "find");
  let result: string;
  let calls: number;
  try {
    result = conflictPreview(
      input,
      input.local.files.map((file) => file.path),
      "store",
    );
    calls = find.mock.calls.length;
  } finally {
    find.mockRestore();
  }
  assert.equal(calls, 0);
  assert.ok(Buffer.byteLength(result) < CONFLICT_DISPLAY_BYTES);
  assert.match(result, /Path: prompts\/999.md/);
});
test("oversized version is refused before its base64 payload is decoded", () => {
  const input = artifact();
  input.local.files = [snapshotFile("prompts/0.md", Buffer.alloc(CONFLICT_DISPLAY_BYTES + 1, 97))];
  const from = vi.spyOn(Buffer, "from");
  let decoded: number;
  try {
    assert.throws(() => conflictPreview(input, ["prompts/0.md"], "store"), /2 MiB display bound/);
    decoded = from.mock.calls.filter((call) => Array.from(call)[1] === "base64").length;
  } finally {
    from.mockRestore();
  }
  assert.equal(decoded, 0);
});
test("cumulative review budget stops before decoding the next otherwise eligible version", () => {
  const input = artifact();
  const file = snapshotFile("prompts/0.md", Buffer.alloc(1100 * 1024, 97));
  input.local.files = [file];
  input.remote.files = [file];
  const from = vi.spyOn(Buffer, "from");
  let decoded: number;
  try {
    assert.throws(() => conflictPreview(input, [file.path], "store"), /2 MiB display bound/);
    decoded = from.mock.calls.filter((call) => Array.from(call)[1] === "base64").length;
  } finally {
    from.mockRestore();
  }
  assert.equal(decoded, 1);
});
test("base64 fallback is checked against remaining display bytes without partial review", () => {
  const input = artifact();
  input.local.files = [snapshotFile("prompts/0.md", Buffer.alloc(1700 * 1024, 255))];
  assert.throws(() => conflictPreview(input, ["prompts/0.md"], "store"), /2 MiB display bound/);
});
