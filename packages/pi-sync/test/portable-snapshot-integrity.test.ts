import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { test } from "vitest";
import { createMockContext } from "../../../test/support.js";
import type { CommandOptions } from "../src/commands/command-types.js";
import { loadConfig } from "../src/settings/config.js";
import { localConfigPath } from "../src/settings/config-file.js";
import { decodeSnapshot } from "../src/snapshot/snapshot-codec.js";
import { readStateForConfig, statePathForConfig } from "../src/state/sync-state-store.js";
import { portableSnapshot, validatePortableSnapshot } from "../src/sync/local-fields.js";
import { mergeJournalPath, readMergeJournal, writeMergeJournal } from "../src/sync/merge-journal.js";
import { pull, push, rollback, syncBoth } from "../src/sync/sync-mutations.js";
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
function image(content: string, filePath = "settings.json") {
  return { ...snapshot([{ path: filePath, content: Buffer.from(content) }]), version: 2, localFields: ["machine"] };
}
for (const content of [
  '{"machine":null}',
  '{"machine":false}',
  '{"machine":0}',
  '{"machine":"DO_NOT_DISCLOSE"}',
  '{"machine":[]}',
  '{"machine":{}}',
  '{"\\u006dachine":"DO_NOT_DISCLOSE"}',
  '\uFEFF{"machine":"DO_NOT_DISCLOSE"}\r\n',
  '{"machine":"DO_NOT_DISCLOSE"',
]) {
  test(`portable content refuses declared root field without disclosure: ${content}`, async () => {
    const bad = image(content);
    assert.throws(
      () => validatePortableSnapshot(bad),
      (error) =>
        error instanceof Error && /Portable snapshot/.test(error.message) && !/DO_NOT_DISCLOSE/.test(error.message),
    );
    await assert.rejects(decodeSnapshot(gzipSync(Buffer.from(JSON.stringify(bad)))), /Portable snapshot/);
  });
}
test("portable validation covers canonicalized paths but not nested names; empty policy/deletion remain valid", () => {
  assert.throws(() => validatePortableSnapshot(image('{"machine":null}', "Settings.json")), /Portable snapshot/);
  validatePortableSnapshot(image('{"nested":{"machine":"allowed"},"theme":"base"}'));
  validatePortableSnapshot({ ...image("not JSON"), localFields: [] });
  validatePortableSnapshot({ ...snapshot([]), version: 2, localFields: ["machine"] });
});

for (const route of ["pull", "sync", "rollback", "push"] as const) {
  test(`${route} refuses an inconsistent custom producer before accepting or mutating`, async () =>
    withTempHome(async (root) => {
      await fs.mkdir(root, { recursive: true });
      const settings = v3S3Settings();
      Object.assign(settings.syncSetups.home.sync, { localFields: ["machine"] });
      await fs.writeFile(localConfigPath(), JSON.stringify({ ...settings, version: 4 }));
      const bytes = '{"theme":"base","machine":"local"}';
      await fs.writeFile(path.join(root, "settings.json"), bytes);
      const { ctx } = createMockContext({ hasUI: true });
      const backend = new MemorySyncBackend();
      const config = await loadConfig();
      const bad = image('{"theme":"base","machine":"DO_NOT_DISCLOSE"}');
      bad.profile = config.snapshotIdentity;
      const clean = portableSnapshot(bad, ["machine"]);
      const head = (await backend.publishSnapshot(clean, { kind: "missing" })).head;
      backend.readSnapshot = async () => ({ ...bad, id: head.snapshotId });
      const state = await readStateForConfig(config);
      const run =
        route === "pull"
          ? pull(ctx, options, () => backend)
          : route === "sync"
            ? syncBoth(ctx, options, () => backend)
            : route === "push"
              ? push(ctx, { ...options, force: true }, undefined, () => backend)
              : rollback(ctx, { ...options, args: [head.snapshotId] }, () => backend);
      await assert.rejects(
        run,
        (error) =>
          error instanceof Error && /Portable snapshot/.test(error.message) && !/DO_NOT_DISCLOSE/.test(error.message),
      );
      assert.equal(await fs.readFile(path.join(root, "settings.json"), "utf8"), bytes);
      assert.deepEqual(await readStateForConfig(config), state);
      await assert.rejects(fs.stat(statePathForConfig(config)), { code: "ENOENT" });
      assert.deepEqual(await backend.readHead(), head);
    }));
}

test("journal permits physical local-only values but rejects them in upload/accepted images without deleting evidence", async () =>
  withTempHome(async (root) => {
    await fs.mkdir(root, { recursive: true });
    const settings = v3S3Settings();
    Object.assign(settings.syncSetups.home.sync, { localFields: ["machine"] });
    await fs.writeFile(localConfigPath(), JSON.stringify({ ...settings, version: 4 }));
    const config = await loadConfig();
    const physical = image('{"theme":"base","machine":"local"}');
    const accepted = portableSnapshot(physical, ["machine"]);
    const journal = {
      version: 1 as const,
      identity: "test",
      before: physical,
      after: physical,
      upload: accepted,
      accepted,
      expectedHead: {
        snapshotId: "old",
        snapshotRef: "old",
        revision: "old",
        createdAt: accepted.createdAt,
        machine: "test",
        syncSessions: false,
      },
      backup: "private-backup",
      stateIdentity: "test",
    };
    await writeMergeJournal(config, journal);
    assert.ok(await readMergeJournal(config));
    await writeMergeJournal(config, { ...journal, accepted: undefined });
    await assert.rejects(readMergeJournal(config), /preserve evidence/);
    for (const key of ["upload", "accepted"] as const) {
      await writeMergeJournal(config, { ...journal, [key]: physical });
      const before = await fs.readFile(mergeJournalPath(config));
      await assert.rejects(readMergeJournal(config), /preserve evidence/);
      assert.deepEqual(await fs.readFile(mergeJournalPath(config)), before);
    }
  }));
