import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { test, vi } from "vitest";
import { createMockContext } from "../../../test/support.js";
import type { CommandOptions } from "../src/commands/command-types.js";
import { loadConfig } from "../src/settings/config.js";
import { localConfigPath } from "../src/settings/config-file.js";
import { updateLocalConfig } from "../src/settings/settings-store.js";
import { createSnapshot } from "../src/snapshot/snapshot.js";
import { readStateForConfig } from "../src/state/sync-state-store.js";
import { portableSnapshot } from "../src/sync/local-fields.js";
import { pull, push, syncBoth } from "../src/sync/sync-mutations.js";
import { v3S3Settings, withTempHome } from "./helpers.js";
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
async function fixture(root: string, fields: string[] | undefined) {
  await fs.mkdir(root, { recursive: true });
  const settings = v3S3Settings();
  if (fields !== undefined) Object.assign(settings.syncSetups.home.sync, { localFields: fields });
  await fs.writeFile(localConfigPath(), JSON.stringify({ ...settings, version: fields === undefined ? 3 : 4 }));
  const bytes = '{"theme":"base","machine":"keep"}';
  await fs.writeFile(path.join(root, "settings.json"), bytes);
  const context = createMockContext({ hasUI: true, mode: "rpc" });
  const ctx = context.ctx as ExtensionContext;
  const backend = new MemorySyncBackend();
  await push(ctx, options, undefined, () => backend);
  const config = await loadConfig();
  return {
    ...context,
    ctx,
    config,
    backend,
    bytes,
    state: await readStateForConfig(config),
    head: await backend.readHead(),
  };
}
async function setPolicy(fields: string[] | undefined) {
  await updateLocalConfig((current) => {
    const setup = current.syncSetups.home;
    assert.ok(setup);
    const sync = { ...setup.sync };
    if (fields === undefined) delete sync.localFields;
    else sync.localFields = fields;
    return { ...current, version: 4, syncSetups: { ...current.syncSetups, home: { ...setup, sync } } };
  });
}
for (const [remotePolicy, requestedPolicy] of [
  [undefined, []],
  [undefined, ["machine"]],
  [[], ["machine"]],
  [["machine"], []],
  [[], undefined],
] as const) {
  test(`force pull refuses remote policy rewrite ${JSON.stringify(remotePolicy)} -> ${JSON.stringify(requestedPolicy)} before review or mutation`, async () =>
    withTempHome(async (root) => {
      const f = await fixture(root, remotePolicy === undefined ? undefined : [...remotePolicy]);
      await setPolicy(requestedPolicy === undefined ? undefined : [...requestedPolicy]);
      let confirmations = 0;
      f.ctx.ui.confirm = async () => {
        confirmations++;
        return true;
      };
      const publication = vi.spyOn(f.backend, "publishSnapshot");
      await assert.rejects(
        pull(f.ctx, { ...options, force: true }, () => f.backend),
        /Pull requires.*policy.*match.*remote/,
      );
      assert.equal(confirmations, 0);
      assert.equal(publication.mock.calls.length, 0);
      assert.equal(f.statuses.get("sync"), undefined);
      assert.equal(await fs.readFile(path.join(root, "settings.json"), "utf8"), f.bytes);
      assert.deepEqual(await readStateForConfig(f.config), f.state);
      assert.deepEqual(await f.backend.readHead(), f.head);
    }));
}

for (const fields of [[], ["machine"]]) {
  for (const confirmed of [false, true]) {
    test(`force pull adopts matching authoritative policy ${JSON.stringify(fields)} only after confirmation=${confirmed}`, async () =>
      withTempHome(async (root) => {
        const f = await fixture(root, undefined);
        assert.ok(f.head);
        const raw = await createSnapshot(f.config.snapshotIdentity, { include: f.config.include });
        const incoming = portableSnapshot(raw, fields);
        const remoteHead = (await f.backend.publishSnapshot(incoming, { kind: "revision", revision: f.head.revision }))
          .head;
        await setPolicy(fields);
        let confirmations = 0;
        f.ctx.ui.confirm = async () => {
          confirmations++;
          return confirmed;
        };
        const publication = vi.spyOn(f.backend, "publishSnapshot");
        assert.equal(
          await pull(f.ctx, { ...options, force: true }, () => f.backend),
          confirmed ? "applied" : "cancelled",
        );
        assert.equal(confirmations, 1);
        assert.equal(publication.mock.calls.length, 0);
        assert.deepEqual(await f.backend.readHead(), remoteHead);
        assert.equal(await fs.readFile(path.join(root, "settings.json"), "utf8"), f.bytes);
        if (confirmed) {
          const state = await readStateForConfig(await loadConfig());
          assert.equal(state.lastAppliedSnapshot, incoming.id);
          assert.deepEqual(state.localFields, fields);
          await syncBoth(f.ctx, options, () => f.backend);
        } else assert.deepEqual(await readStateForConfig(f.config), f.state);
      }));
  }
}
