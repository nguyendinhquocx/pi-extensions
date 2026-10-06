import assert from "node:assert/strict";
import { test, vi } from "vitest";
import { readMergeAncestors, stageMergeBaseline } from "../src/state/merge-baseline-store.js";
import { snapshotFile } from "../src/sync/content-conflicts.js";
import type { FileMergeDecision } from "../src/sync/file-merge-planner.js";
import { acceptedMergeFiles } from "../src/sync/partial-progress.js";
import { fileHashMap } from "../src/sync/sync-state.js";
import { snapshot, withTempHome } from "./helpers.js";
import { fixture } from "./partial-sync-fixture.js";

for (const withheldPaths of [[], ["prompts/a.md"], ["prompts/a.md", "prompts/missing.md", "prompts/foo.md"]])
  test(`indexed accepted projection preserves exact versions and absence for ${withheldPaths.join(", ") || "no withheld paths"}`, () => {
    const files = [
      snapshotFile("prompts/a.md", Buffer.from("local\r\n")),
      snapshotFile("prompts/Foo.md", Buffer.from("upper")),
      snapshotFile("prompts/foo.md", Buffer.from("lower")),
    ];
    const decisions: FileMergeDecision[] = [
      {
        kind: "accepted",
        path: "prompts/a.md",
        source: "remote",
        file: snapshotFile("prompts/a.md", Buffer.from("remote\n")),
      },
      { kind: "accepted", path: "prompts/missing.md", source: "local", file: undefined },
      { kind: "accepted", path: "prompts/Foo.md", source: "merged", file: files[1] },
      { kind: "conflict", path: "prompts/foo.md", reason: "both-changed" },
    ];
    const withheld = new Set(withheldPaths);
    const expected = decisions.flatMap((decision) =>
      decision.kind === "accepted" && !withheld.has(decision.path) && decision.file
        ? [decision.file]
        : withheld.has(decision.path)
          ? files.filter((file) => file.path === decision.path)
          : [],
    );
    assert.deepEqual(acceptedMergeFiles(decisions, files, withheld), expected);
  });

test("16,384-file withheld projection never scans local files per decision", () => {
  const files = Array.from({ length: 16_384 }, (_, index) =>
    snapshotFile(`prompts/${index}.md`, Buffer.from("local\n")),
  );
  const decisions: FileMergeDecision[] = files.map((file) => ({
    kind: "conflict",
    path: file.path,
    reason: "both-changed",
  }));
  const filter = vi.spyOn(files, "filter").mockImplementation(() => {
    throw new Error("per-decision local scan");
  });
  try {
    assert.deepEqual(acceptedMergeFiles(decisions, files, new Set(files.map((file) => file.path))), files);
  } finally {
    filter.mockRestore();
  }
});

test("wide ancestor carry uses staged membership without duplicate files or invented hashes", async () =>
  withTempHome(async (root) => {
    const f = await fixture(root);
    const files = Array.from({ length: 16_383 }, (_, index) => ({
      path: `prompts/${index}.md`,
      content: Buffer.from(`base ${index}\n`),
    }));
    const base = snapshot(files);
    const previous = { ...f.state, lastFileHashes: fileHashMap(base) };
    await stageMergeBaseline(f.config, base, previous);
    const next = snapshot([...files.slice(0, 8192), { path: "prompts/new.md", content: Buffer.from("new\n") }]);
    const accepted = {
      ...previous,
      lastRemoteRevision: "next",
      lastFileHashes: { ...previous.lastFileHashes, ...fileHashMap(next) },
    };
    delete accepted.lastFileHashes["prompts/16382.md"];
    accepted.lastFileHashes["prompts/16381.md"] = "0".repeat(64);
    const filter = next.files.filter.bind(next.files);
    const scanning = vi.spyOn(next.files, "filter").mockImplementation((predicate, thisArg) => {
      const result = filter(predicate, thisArg);
      Object.defineProperty(result, "some", {
        value: () => {
          throw new Error("per-ancestor membership scan");
        },
      });
      return result;
    });
    try {
      await stageMergeBaseline(f.config, next, accepted, previous);
    } finally {
      scanning.mockRestore();
    }
    const cached = await readMergeAncestors(f.config, accepted);
    assert.ok(cached);
    assert.equal(cached.length, 16_382);
    const paths = new Set(cached.map((file) => file.path));
    assert.equal(paths.size, cached.length);
    assert.ok(paths.has("prompts/new.md"));
    assert.ok(paths.has("prompts/16380.md"));
    assert.equal(paths.has("prompts/16381.md"), false);
    assert.equal(paths.has("prompts/16382.md"), false);
    for (const file of cached) assert.equal(file.sha256, accepted.lastFileHashes[file.path]);
  }));
