import assert from "node:assert/strict";
import { test } from "vitest";
import {
  formatApplyPreview,
  formatDiff,
  formatPublicationPreview,
  formatSnapshotOnlyDiff,
} from "../src/ui/sync-format.js";
import { safeTerminalText, snapshotPathLabel } from "../src/ui/terminal-text.js";
import { snapshot } from "./helpers.js";

for (const character of ["\n", "\t", "\u001b", "\u0085", "\u061c", "\u200b", "\u202e", "\u2066", "\ufeff"])
  test(`review path escapes ${JSON.stringify(character)} before multiline formatting without changing payload`, () => {
    const filePath = `prompts/name${character}tail.md`;
    const empty = snapshot([]);
    const before = snapshot([{ path: filePath, content: Buffer.from("before") }]);
    const after = snapshot([{ path: filePath, content: Buffer.from("after") }]);
    const raw = JSON.stringify(after);
    const label = `prompts/name\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}tail.md`;
    assert.equal(snapshotPathLabel(filePath), label);
    assert.equal(safeTerminalText(filePath), "prompts/name?tail.md");
    for (const output of [
      formatDiff(empty, after),
      formatDiff(after, empty),
      formatDiff(before, after),
      formatApplyPreview(empty, after),
      formatApplyPreview(before, after),
      formatApplyPreview(after, empty),
      formatPublicationPreview(undefined, after),
      formatPublicationPreview(before, after),
      formatSnapshotOnlyDiff("Snapshot", after),
    ]) {
      assert.ok(output.includes(label));
      assert.ok(!output.includes(filePath));
    }
    assert.equal(JSON.stringify(after), raw);
  });
