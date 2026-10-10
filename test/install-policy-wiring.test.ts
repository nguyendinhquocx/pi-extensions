import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { test } from "vitest";

const root = path.resolve(import.meta.dirname, "..");
const read = (filename: string) => readFileSync(path.join(root, filename), "utf8");

test("repository script approvals are exact registry versions and denials stay explicit", () => {
  const manifest = JSON.parse(read("package.json")) as { allowScripts: Record<string, boolean> };
  for (const [identity, allowed] of Object.entries(manifest.allowScripts)) {
    assert.equal(typeof allowed, "boolean");
    if (allowed) assert.match(identity, /@\d+\.\d+\.\d+$/u);
  }
  assert.equal(manifest.allowScripts.fsevents, false);
  assert.equal(manifest.allowScripts["@google/genai"], false);
  assert.equal(manifest.allowScripts.protobufjs, false);
});

test("policy and toolchain changes select the full test gate", async () => {
  const module = (await import(pathToFileURL(path.join(root, "scripts/select-affected-tests.mjs")).href)) as {
    selectAffectedTests(root: string, files: string[]): { mode: string };
  };
  for (const file of [".npmrc", ".node-version"]) {
    assert.equal(module.selectAffectedTests(root, [file]).mode, "full");
  }
});
