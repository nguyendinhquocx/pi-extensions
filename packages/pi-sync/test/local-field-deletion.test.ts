import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { test } from "vitest";
import { createMockContext } from "../../../test/support.js";
import type { CommandOptions } from "../src/commands/command-types.js";
import { loadConfig } from "../src/settings/config.js";
import { localConfigPath } from "../src/settings/config-file.js";
import { readStateForConfig } from "../src/state/sync-state-store.js";
import { overlayLocalFields, portableSnapshot } from "../src/sync/local-fields.js";
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
const image = (text: string) => snapshot([{ path: "settings.json", content: Buffer.from(text) }]);

for (const text of ['{"theme":"dark"}', "{}", '\uFEFF{\r\n "theme": "dark"\r\n}\r\n']) {
  test(`portable settings deletion is safe with absent excluded fields: ${JSON.stringify(text)}`, () => {
    const deleted = portableSnapshot(snapshot([]), ["machine"]);
    assert.equal(overlayLocalFields(deleted, image(text), ["machine"]), deleted);
    assert.equal(overlayLocalFields(deleted, snapshot([]), ["machine"]), deleted);
  });
}
for (const value of [null, false, 0, "", [], {}]) {
  test(`portable deletion preserves present excluded value: ${JSON.stringify(value)}`, () => {
    assert.throws(
      () =>
        overlayLocalFields(portableSnapshot(snapshot([]), ["machine"]), image(JSON.stringify({ machine: value })), [
          "machine",
        ]),
      /deletion requires manual review/,
    );
  });
}
for (const text of ['{"secret":"DO_NOT_DISCLOSE"', '{/*comment*/"theme":"dark"}', "[]"]) {
  test(`unsupported local JSON refuses deletion: ${JSON.stringify(text)}`, () => {
    assert.throws(
      () => overlayLocalFields(portableSnapshot(snapshot([]), ["machine"]), image(text), ["machine"]),
      (error) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /Unsupported settings JSON/);
        assert.doesNotMatch(error.message, /DO_NOT_DISCLOSE/);
        return true;
      },
    );
  });
}

for (const route of ["pull", "rollback", "merge"] as const) {
  for (const hasExcludedValue of [false, true]) {
    test(`${route} portable deletion ${hasExcludedValue ? "refuses local-only loss" : "converges without local-only values"}`, async () =>
      withTempHome(async (root) => {
        await fs.mkdir(root, { recursive: true });
        const settings = v3S3Settings();
        Object.assign(settings.syncSetups.home.sync, { localFields: ["machine"] });
        await fs.writeFile(localConfigPath(), JSON.stringify({ ...settings, version: 4 }));
        const bytes = JSON.stringify({ theme: "base", ...(hasExcludedValue ? { machine: null } : {}) });
        await fs.writeFile(path.join(root, "settings.json"), bytes);
        const { ctx } = createMockContext({ hasUI: true });
        const backend = new MemorySyncBackend();
        await push(ctx, options, undefined, () => backend);
        const config = await loadConfig();
        const state = await readStateForConfig(config);
        const previousHead = await backend.readHead();
        assert.ok(previousHead);
        const empty = portableSnapshot(
          { ...snapshot([]), profile: config.snapshotIdentity, selection: { version: 1, include: config.include } },
          ["machine"],
        );
        const incoming = (await backend.publishSnapshot(empty, { kind: "revision", revision: previousHead.revision }))
          .head;
        const operation =
          route === "pull"
            ? pull(ctx, options, () => backend)
            : route === "rollback"
              ? rollback(
                  ctx as Parameters<typeof rollback>[0],
                  { ...options, args: [incoming.snapshotRef] },
                  () => backend,
                )
              : syncBoth(ctx, options, () => backend);
        if (hasExcludedValue) {
          await assert.rejects(operation, /deletion requires manual review/);
          assert.equal(await fs.readFile(path.join(root, "settings.json"), "utf8"), bytes);
          assert.deepEqual(await readStateForConfig(config), state);
          assert.deepEqual(await backend.readHead(), incoming);
        } else {
          await operation;
          await assert.rejects(fs.stat(path.join(root, "settings.json")), { code: "ENOENT" });
          assert.deepEqual((await readStateForConfig(config)).lastFileHashes, {});
          await syncBoth(ctx, options, () => backend);
        }
      }));
  }
}
