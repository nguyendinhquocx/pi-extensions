import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { test } from "vitest";
import { createMockContext } from "../../../test/support.js";
import type { CommandOptions } from "../src/commands/command-types.js";
import { loadConfig } from "../src/settings/config.js";
import { localConfigPath } from "../src/settings/config-file.js";
import { updateLocalConfig } from "../src/settings/settings-store.js";
import { readStateForConfig, statePathForConfig } from "../src/state/sync-state-store.js";
import { portableSnapshot } from "../src/sync/local-fields.js";
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
for (const configured of [undefined, []]) {
  for (const remotePolicy of [undefined, []]) {
    test(`empty first acceptance enforces policy ${JSON.stringify(configured)} vs ${JSON.stringify(remotePolicy)}`, async () =>
      withTempHome(async (root) => {
        await fs.mkdir(root, { recursive: true });
        const settings = v3S3Settings();
        if (configured !== undefined) Object.assign(settings.syncSetups.home.sync, { localFields: configured });
        await fs.writeFile(
          localConfigPath(),
          JSON.stringify({ ...settings, version: configured === undefined ? 3 : 4 }),
        );
        const config = await loadConfig();
        const backend = new MemorySyncBackend();
        const remote = portableSnapshot(
          { ...snapshot([]), profile: config.snapshotIdentity, selection: { version: 1, include: config.include } },
          remotePolicy,
        );
        const head = (await backend.publishSnapshot(remote, { kind: "missing" })).head;
        const { ctx } = createMockContext({ hasUI: true });
        if ((configured === undefined) !== (remotePolicy === undefined)) {
          await assert.rejects(
            syncBoth(ctx, options, () => backend),
            /local-field policy differs/,
          );
          await assert.rejects(fs.stat(statePathForConfig(config)), { code: "ENOENT" });
        } else {
          await syncBoth(ctx, options, () => backend);
          const state = await readStateForConfig(config);
          assert.equal(state.lastAppliedSnapshot, head.snapshotId);
          assert.deepEqual(state.localFields, configured);
          await syncBoth(ctx, options, () => backend);
        }
        assert.deepEqual(await backend.readHead(), head);
      }));
  }
}
for (const changeConfig of [false, true]) {
  test(`established byte-identical portable head cannot bypass migration (change config=${changeConfig})`, async () =>
    withTempHome(async (root) => {
      await fs.mkdir(root, { recursive: true });
      await fs.writeFile(localConfigPath(), JSON.stringify(v3S3Settings()));
      const { ctx } = createMockContext({ hasUI: true });
      const backend = new MemorySyncBackend();
      await push(ctx, options, undefined, () => backend);
      const config = await loadConfig();
      const state = await readStateForConfig(config);
      const oldHead = await backend.readHead();
      assert.ok(oldHead);
      const remote = { ...portableSnapshot(await backend.readSnapshot(oldHead.snapshotRef), []), id: "portable-head" };
      const head = (await backend.publishSnapshot(remote, { kind: "revision", revision: oldHead.revision })).head;
      if (changeConfig)
        await updateLocalConfig((current) => {
          const setup = current.syncSetups.home;
          assert.ok(setup);
          return {
            ...current,
            version: 4,
            syncSetups: { ...current.syncSetups, home: { ...setup, sync: { ...setup.sync, localFields: [] } } },
          };
        });
      await assert.rejects(
        syncBoth(ctx, options, () => backend),
        /local-field policy differs|Local-field rules changed/,
      );
      assert.deepEqual(await readStateForConfig(config), state);
      assert.deepEqual(await backend.readHead(), head);
    }));
}
