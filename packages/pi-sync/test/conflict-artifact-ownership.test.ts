import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { test, vi } from "vitest";
import { localConfigPath } from "../src/settings/config-file.js";
import {
  readStateForConfig,
  statePathForConfig,
  syncStateFingerprint,
  writeStateForConfig,
} from "../src/state/sync-state-store.js";
import { conflictDirectory, readConflictArtifact } from "../src/sync/conflict-artifacts.js";
import { readMergeJournal } from "../src/sync/merge-journal.js";
import { mergeSync } from "../src/sync/merged-sync.js";
import { withTempHome } from "./helpers.js";
import { fixture, options, publish } from "./partial-sync-fixture.js";

async function noTransfer(root: string) {
  const f = await fixture(root);
  await mergeSync(f.context.ctx, options, () => f.backend);
  await fs.writeFile(path.join(root, "AGENTS.md"), "LOCAL\nb\nc\n");
  await publish(f, { "AGENTS.md": "REMOTE\nb\nc\n" });
  const state = await readStateForConfig(f.config);
  return { ...f, state };
}
async function names(config: Parameters<typeof conflictDirectory>[0]) {
  try {
    return await fs.readdir(conflictDirectory(config));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

test("stale no-transfer head is rejected before creating conflict artifacts", async () =>
  withTempHome(async (root) => {
    const f = await noTransfer(root);
    const read = f.backend.readHead.bind(f.backend);
    let reads = 0;
    const observer = vi.spyOn(f.backend, "readHead").mockImplementation(async (...args) => {
      if (++reads === 2) {
        observer.mockRestore();
        await publish(f, { "AGENTS.md": "NEW REMOTE\nb\nc\n" });
      }
      return read(...args);
    });
    const create = vi.spyOn(fs, "link");
    let creations = 0;
    try {
      await assert.rejects(
        mergeSync(f.context.ctx, options, () => f.backend),
        /Remote changed before baseline acceptance/,
      );
      creations = create.mock.calls.length;
    } finally {
      observer.mockRestore();
      create.mockRestore();
    }
    assert.equal(creations, 0);
    assert.deepEqual(await names(f.config), []);
    assert.equal(syncStateFingerprint(await readStateForConfig(f.config)), syncStateFingerprint(f.state));
  }));

for (const changed of ["remote", "local", "baseline", "settings", "cancel", "session"] as const)
  test(`no-transfer ${changed} race releases only newly created unreferenced evidence`, async () =>
    withTempHome(async (root) => {
      const f = await noTransfer(root);
      const link = fs.link.bind(fs);
      const controller = new AbortController();
      const manager = (f.context.ctx as ExtensionContext).sessionManager;
      const id = vi.spyOn(manager, "getSessionId");
      let created = false;
      const mutation = vi.spyOn(fs, "link").mockImplementation(async (from, to) => {
        await link(from, to);
        if (String(to).startsWith(conflictDirectory(f.config)) && String(to).endsWith(".json")) {
          created = true;
          if (changed === "remote") await publish(f, { "AGENTS.md": "NEW REMOTE\nb\nc\n" });
          if (changed === "local") await fs.writeFile(path.join(root, "AGENTS.md"), "newer local bytes\n");
          if (changed === "baseline")
            await writeStateForConfig(f.config, { ...f.state, lastRemoteRevision: "other accepted revision" });
          if (changed === "settings") {
            const settings = JSON.parse(await fs.readFile(localConfigPath(), "utf8"));
            settings.syncSetups.home.sync.partialSync = false;
            await fs.writeFile(localConfigPath(), JSON.stringify(settings));
          }
          if (changed === "cancel") controller.abort(new Error("cancelled artifact acceptance"));
          if (changed === "session") id.mockReturnValue("replacement session");
        }
      });
      try {
        await assert.rejects(mergeSync(f.context.ctx, { ...options, signal: controller.signal }, () => f.backend));
      } finally {
        mutation.mockRestore();
        id.mockRestore();
      }
      assert.equal(created, true);
      assert.deepEqual(await names(f.config), []);
      if (changed !== "baseline")
        assert.equal(syncStateFingerprint(await readStateForConfig(f.config)), syncStateFingerprint(f.state));
      assert.equal(await readMergeJournal(f.config), undefined);
    }));

for (const existing of [false, true])
  test(`acceptance failure ${existing ? "preserves pre-existing" : "releases new"} evidence`, async () =>
    withTempHome(async (root) => {
      const f = await noTransfer(root);
      if (existing) {
        await mergeSync(f.context.ctx, options, () => f.backend);
        await writeStateForConfig(f.config, f.state);
      }
      const before = await names(f.config);
      const rename = fs.rename.bind(fs);
      const failure = vi.spyOn(fs, "rename").mockImplementation(async (from, to) => {
        if (to === statePathForConfig(f.config)) throw new Error("acceptance write failed");
        return rename(from, to);
      });
      try {
        await assert.rejects(
          mergeSync(f.context.ctx, options, () => f.backend),
          /acceptance write failed/,
        );
      } finally {
        failure.mockRestore();
      }
      assert.deepEqual(await names(f.config), before);
      assert.equal(syncStateFingerprint(await readStateForConfig(f.config)), syncStateFingerprint(f.state));
      await mergeSync(f.context.ctx, options, () => f.backend);
      const accepted = await readStateForConfig(f.config);
      const token = accepted.unresolved?.[0]?.artifact;
      assert.ok(token);
      assert.equal((await names(f.config)).length, 1);
      assert.ok(await readConflictArtifact(f.config, f.backend.identity, token));
    }));

test("cleanup never removes a same-content replacement inode", async () =>
  withTempHome(async (root) => {
    const f = await noTransfer(root);
    const link = fs.link.bind(fs);
    const controller = new AbortController();
    const replacement = vi.spyOn(fs, "link").mockImplementation(async (from, to) => {
      await link(from, to);
      if (String(to).startsWith(conflictDirectory(f.config)) && String(to).endsWith(".json")) {
        const foreign = `${to}.foreign`;
        await fs.copyFile(to, foreign);
        await fs.rename(foreign, to);
        controller.abort();
      }
    });
    try {
      await assert.rejects(mergeSync(f.context.ctx, { ...options, signal: controller.signal }, () => f.backend));
    } finally {
      replacement.mockRestore();
    }
    const retained = await names(f.config);
    assert.equal(retained.length, 1);
    assert.ok(retained[0]?.endsWith(".json"));
  }));

test("failed local transfer retains evidence referenced by the durable journal", async () =>
  withTempHome(async (root) => {
    const f = await noTransfer(root);
    await publish(f, { "prompts/safe.md": "incoming\n" });
    const rename = fs.rename.bind(fs);
    const failure = vi.spyOn(fs, "rename").mockImplementation(async (from, to) => {
      if (to === path.join(root, "prompts/safe.md")) throw new Error("local install failed");
      return rename(from, to);
    });
    try {
      await assert.rejects(
        mergeSync(f.context.ctx, options, () => f.backend),
        /local install failed/,
      );
    } finally {
      failure.mockRestore();
    }
    const journal = await readMergeJournal(f.config);
    assert.ok(journal?.progress?.groups.length);
    assert.equal((await names(f.config)).length, 1);
    await mergeSync(f.context.ctx, options, () => f.backend);
    assert.equal(await readMergeJournal(f.config), undefined);
    assert.equal((await names(f.config)).length, 1);
    assert.ok((await readStateForConfig(f.config)).unresolved?.length);
  }));
