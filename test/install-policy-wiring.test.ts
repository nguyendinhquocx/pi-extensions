import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { test } from "vitest";

const root = path.resolve(import.meta.dirname, "..");
const read = (filename: string) => readFileSync(path.join(root, filename), "utf8");

test("workflows validate the pinned policy before every dependency install", () => {
  for (const filename of [".github/workflows/ci.yml", ".github/workflows/publish.yml"]) {
    const workflow = read(filename);
    assert.doesNotMatch(workflow, /\bnpm install\b/u);
    assert.match(workflow, /node-version-file:\s*\.node-version/u);
    const commands = [...workflow.matchAll(/\brun:\s*([^\n]+)/gu)].map((match) => match[1]?.trim());
    for (const [index, command] of commands.entries()) {
      if (command === "npm ci") assert.equal(commands[index - 1], "node scripts/check-install-policy.mjs");
    }
    assert.ok(commands.includes("npm ci"));
  }
  assert.doesNotMatch(read(".github/workflows/ci.yml"), /^\s*macos-install:/mu);
  assert.match(read(".github/workflows/publish.yml"), /NPM_CONFIG_PROVENANCE:\s*"true"/u);
});

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
