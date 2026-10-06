import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { test, vi } from "vitest";
import { expectedRemoteHead } from "../src/backends/sync-backend.js";
import { readStateForConfig, statePathForConfig, syncStateFingerprint } from "../src/state/sync-state-store.js";
import { conflictArtifactFingerprint, readConflictArtifact } from "../src/sync/conflict-artifacts.js";
import { snapshotFile } from "../src/sync/content-conflicts.js";
import { readMergeJournal } from "../src/sync/merge-journal.js";
import { mergeSync } from "../src/sync/merged-sync.js";
import { push } from "../src/sync/sync-mutations.js";
import { withTempHome } from "./helpers.js";
import { fixture, options } from "./partial-sync-fixture.js";

async function replacementFixture(root: string, children: string[]) {
  const f = await fixture(root);
  const parent = path.join(root, "prompts/parent");
  for (const child of children) {
    const target = path.join(parent, child);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, "base\n");
  }
  await push(f.context.ctx, options, undefined, () => f.backend);
  for (const child of children) await fs.writeFile(path.join(parent, child), "local\n");
  const head = await f.backend.readHead();
  assert.ok(head);
  const remote = await f.backend.readSnapshot(head.snapshotRef);
  await f.backend.publishSnapshot(
    {
      ...remote,
      id: "directory-replacement",
      files: [
        ...remote.files.filter((file) => !file.path.startsWith("prompts/parent/")),
        snapshotFile("prompts/parent", Buffer.from("remote\n")),
      ],
    },
    expectedRemoteHead(head),
  );
  await mergeSync(f.context.ctx, options, () => f.backend);
  const state = await readStateForConfig(f.config);
  const group = state.unresolved?.find((group) => group.paths.includes(`prompts/parent/${children[0]}`));
  assert.ok(group);
  const artifact = await readConflictArtifact(f.config, f.backend.identity, group.artifact);
  const resolution = {
    token: group.artifact,
    group: artifact.groups.findIndex((group) => group.paths.includes(`prompts/parent/${children[0]}`)),
    source: "remote" as const,
    stateIdentity: syncStateFingerprint(state),
    artifactIdentity: conflictArtifactFingerprint(artifact),
  };
  return { ...f, parent, resolution };
}

for (const children of [
  ["a.md", "b.md", "c.md"],
  ["nested/child.md"],
  ["a.md", "nested/deeper/b.md", "nested/c.md", "other/d.md"],
])
  test(`reviewed directory replacement removes all descendants: ${children.join(", ")}`, async () =>
    withTempHome(async (root) => {
      const f = await replacementFixture(root, children);
      await mergeSync(f.context.ctx, options, () => f.backend, f.resolution);
      assert.equal(await fs.readFile(f.parent, "utf8"), "remote\n");
      assert.equal((await readStateForConfig(f.config)).unresolved, undefined);
      assert.equal(await readMergeJournal(f.config), undefined);
    }));

for (const interruption of ["error", "abort", "unknown-file", "unknown-directory"] as const)
  test(`nested directory replacement preserves recovery evidence after ${interruption}`, async () =>
    withTempHome(async (root) => {
      const f = await replacementFixture(root, ["nested/a.md", "nested/b.md", "c.md"]);
      const rm = fs.rm.bind(fs);
      const controller = new AbortController();
      let interrupted = false;
      const mutation = vi.spyOn(fs, "rm").mockImplementation(async (...args) => {
        await rm(...args);
        if (!interrupted && String(args[0]) === path.join(f.parent, "nested/a.md")) {
          interrupted = true;
          if (interruption === "error") throw new Error("injected descendant deletion failure");
          if (interruption === "abort") controller.abort();
          if (interruption === "unknown-file")
            await fs.writeFile(path.join(f.parent, "nested/unknown.md"), "newer private bytes");
          if (interruption === "unknown-directory") await fs.mkdir(path.join(f.parent, "nested/unknown"));
        }
      });
      try {
        await assert.rejects(
          mergeSync(f.context.ctx, { ...options, signal: controller.signal }, () => f.backend, f.resolution),
        );
        assert.equal(interrupted, true);
      } finally {
        mutation.mockRestore();
      }
      assert.ok(await readMergeJournal(f.config));
      assert.ok((await fs.stat(f.parent)).isDirectory());
      if (interruption.startsWith("unknown")) {
        await assert.rejects(mergeSync(f.context.ctx, options, () => f.backend));
        if (interruption === "unknown-file")
          assert.equal(await fs.readFile(path.join(f.parent, "nested/unknown.md"), "utf8"), "newer private bytes");
        else assert.ok((await fs.stat(path.join(f.parent, "nested/unknown"))).isDirectory());
        assert.ok(await readMergeJournal(f.config));
      } else {
        const publish = vi.spyOn(f.backend, "publishSnapshot");
        await mergeSync(f.context.ctx, options, () => f.backend);
        assert.equal(publish.mock.calls.length, 0);
        assert.equal(await fs.readFile(f.parent, "utf8"), "remote\n");
        assert.equal(await readMergeJournal(f.config), undefined);
      }
    }));

test("directory replacement resumes after complete installation but failed baseline acceptance", async () =>
  withTempHome(async (root) => {
    const f = await replacementFixture(root, ["nested/a.md", "nested/b.md", "c.md"]);
    const rename = fs.rename.bind(fs);
    let failed = false;
    const acceptance = vi.spyOn(fs, "rename").mockImplementation(async (from, to) => {
      if (!failed && to === statePathForConfig(f.config) && (await fs.stat(f.parent)).isFile()) {
        failed = true;
        throw new Error("injected postimage acceptance failure");
      }
      return rename(from, to);
    });
    try {
      await assert.rejects(
        mergeSync(f.context.ctx, options, () => f.backend, f.resolution),
        /postimage acceptance failure/,
      );
      assert.equal(failed, true);
    } finally {
      acceptance.mockRestore();
    }
    assert.equal(await fs.readFile(f.parent, "utf8"), "remote\n");
    assert.ok(await readMergeJournal(f.config));
    const publish = vi.spyOn(f.backend, "publishSnapshot");
    await mergeSync(f.context.ctx, options, () => f.backend);
    assert.equal(publish.mock.calls.length, 0);
    assert.equal(await readMergeJournal(f.config), undefined);
    assert.equal((await readStateForConfig(f.config)).unresolved, undefined);
  }));
