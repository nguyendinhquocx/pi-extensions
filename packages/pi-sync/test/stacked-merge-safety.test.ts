import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { test, vi } from "vitest";
import { createMockContext } from "../../../test/support.js";
import { expectedRemoteHead } from "../src/backends/sync-backend.js";
import type { CommandOptions } from "../src/commands/command-types.js";
import { loadConfig } from "../src/settings/config.js";
import { localConfigPath } from "../src/settings/config-file.js";
import { readMergeAncestor } from "../src/state/merge-baseline-store.js";
import { readStateForConfig } from "../src/state/sync-state-store.js";
import { mergeJournalPath, readMergeJournal } from "../src/sync/merge-journal.js";
import { push, syncBoth } from "../src/sync/sync-mutations.js";
import { snapshot, v3S3Settings, withTempHome } from "./helpers.js";
import { MemorySyncBackend } from "./memory-sync-backend.js";

const options: CommandOptions = {
  args: [],
  yes: true,
  force: false,
  stale: false,
  silent: false,
  reload: false,
  auto: false,
};
async function fixture(root: string, sessions = false) {
  await fs.mkdir(root, { recursive: true });
  const settings = v3S3Settings({ include: ["settings.json", "AGENTS.md", ...(sessions ? ["sessions"] : [])] });
  Object.assign(settings.syncSetups.home.sync, {
    localFields: ["machine"],
    mergeSettings: true,
    automaticTransfer: true,
  });
  await fs.writeFile(localConfigPath(), JSON.stringify({ ...settings, version: 4 }));
  await fs.writeFile(path.join(root, "settings.json"), JSON.stringify({ theme: "base", machine: "private" }));
  await fs.writeFile(path.join(root, "AGENTS.md"), "base instructions");
  const context = createMockContext();
  const backend = new MemorySyncBackend();
  await push(context.ctx, options, undefined, () => backend);
  const config = await loadConfig();
  async function remoteEdit(filePath: string, content: string) {
    const head = await backend.readHead();
    assert.ok(head);
    const original = await backend.readSnapshot(head.snapshotRef);
    const files = snapshot([{ path: filePath, content: Buffer.from(content) }]).files;
    return backend.publishSnapshot(
      {
        ...original,
        id: `remote-${(await backend.listHistory()).length}`,
        files: [...original.files.filter((file) => file.path !== filePath), ...files],
      },
      expectedRemoteHead(head),
    );
  }
  return { backend, context, config, remoteEdit };
}

for (const invalid of ['{"sessionDir":true}', '{"sessionDir":42}'])
  test(`portable settings with sessions reject invalid root input ${invalid}`, async () =>
    withTempHome(async (root) => {
      const f = await fixture(root, true);
      await f.remoteEdit("settings.json", invalid);
      const state = await readStateForConfig(f.config);
      const head = await f.backend.readHead();
      await assert.rejects(syncBoth(f.context.ctx, options, () => f.backend));
      assert.deepEqual(await readStateForConfig(f.config), state);
      assert.deepEqual(await f.backend.readHead(), head);
      assert.equal(await readMergeJournal(f.config), undefined);
    }));

test("portable apply-only head advancement retires unpublished evidence and preserves local overlay", async () =>
  withTempHome(async (root) => {
    const f = await fixture(root);
    await f.remoteEdit("AGENTS.md", "remote instructions");
    const state = await readStateForConfig(f.config);
    const rename = fs.rename.bind(fs);
    let advanced = false;
    const spy = vi.spyOn(fs, "rename").mockImplementation(async (from, to) => {
      await rename(from, to);
      if (!advanced && to === mergeJournalPath(f.config)) {
        advanced = true;
        await f.remoteEdit("AGENTS.md", "newer remote instructions");
      }
    });
    try {
      assert.equal(await syncBoth(f.context.ctx, options, () => f.backend), "cancelled");
      assert.equal(advanced, true);
      assert.equal(await readMergeJournal(f.config), undefined);
      assert.deepEqual(await readStateForConfig(f.config), state);
      assert.equal(await fs.readFile(path.join(root, "AGENTS.md"), "utf8"), "base instructions");
      assert.equal(JSON.parse(await fs.readFile(path.join(root, "settings.json"), "utf8")).machine, "private");
    } finally {
      spy.mockRestore();
    }
    await syncBoth(f.context.ctx, options, () => f.backend);
    const accepted = await readStateForConfig(f.config);
    assert.deepEqual(accepted.localFields, ["machine"]);
    const ancestor = await readMergeAncestor(f.config, accepted, "settings.json");
    assert.ok(ancestor);
    assert.doesNotMatch(ancestor.toString(), /private|machine/);
    assert.equal(await fs.readFile(path.join(root, "AGENTS.md"), "utf8"), "newer remote instructions");
  }));

test("portable merge uses raw local bytes for post-journal stale checks", async () =>
  withTempHome(async (root) => {
    const f = await fixture(root);
    await f.remoteEdit("AGENTS.md", "remote instructions");
    const rename = fs.rename.bind(fs);
    let edited = false;
    const spy = vi.spyOn(fs, "rename").mockImplementation(async (from, to) => {
      await rename(from, to);
      if (!edited && to === mergeJournalPath(f.config)) {
        edited = true;
        await fs.writeFile(path.join(root, "settings.json"), JSON.stringify({ theme: "base", machine: "new private" }));
      }
    });
    try {
      await assert.rejects(
        syncBoth(f.context.ctx, options, () => f.backend),
        /changed before publication/,
      );
      assert.equal(edited, true);
      assert.equal(await readMergeJournal(f.config), undefined);
      assert.equal(JSON.parse(await fs.readFile(path.join(root, "settings.json"), "utf8")).machine, "new private");
      assert.equal(await fs.readFile(path.join(root, "AGENTS.md"), "utf8"), "base instructions");
    } finally {
      spy.mockRestore();
    }
  }));

test("portable no-op delegation downloads once and keeps the accepted ancestor", async () =>
  withTempHome(async (root) => {
    const f = await fixture(root);
    const read = vi.spyOn(f.backend, "readSnapshot");
    try {
      await syncBoth(f.context.ctx, options, () => f.backend);
      assert.equal(read.mock.calls.length, 1);
      assert.ok(await readMergeAncestor(f.config, await readStateForConfig(f.config), "settings.json"));
    } finally {
      read.mockRestore();
    }
  }));
