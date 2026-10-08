import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { withFileMutationQueue } from "@earendil-works/pi-coding-agent";
import { test, vi } from "vitest";
import { createSnapshot } from "../src/snapshot/snapshot.js";
import { readStateForConfig, syncStateFingerprint } from "../src/state/sync-state-store.js";
import { applyMergedSnapshot, preflightMergedTargets } from "../src/sync/merge-apply.js";
import {
  mergeJournalIdentity,
  mergeJournalPath,
  readMergeJournal,
  writeMergeJournal,
} from "../src/sync/merge-journal.js";
import { syncBoth } from "../src/sync/sync-mutations.js";
import { BUILT_IN_SYNC_ROOTS } from "../src/sync/sync-policy.js";
import { snapshot, withTempHome } from "./helpers.js";
import { createMergeFixture, mergeOptions } from "./merged-sync-fixture.js";

const refusal = /noncanonical case variant/;
const original = "original instructions\n";

for (const auto of [false, true])
  for (const deletion of [false, true])
    test(`${auto ? "automatic" : "manual"} merge refuses case-variant ${deletion ? "deletion" : "edit"} before publication`, async () =>
      withTempHome(async (root) => {
        const f = await createMergeFixture(root, undefined, true);
        await fs.rename(path.join(root, "AGENTS.md"), path.join(root, "agents.md"));
        const observed = await createSnapshot(f.config.snapshotIdentity, { include: f.config.include });
        assert.equal(
          observed.files.find((file) => file.path === "AGENTS.md")?.sha256,
          f.base.files.find((file) => file.path === "AGENTS.md")?.sha256,
        );
        await f.remoteEdit("AGENTS.md", deletion ? undefined : "remote instructions\n");
        await fs.writeFile(path.join(root, "settings.json"), '{"theme":"local"}\n');
        const state = await readStateForConfig(f.config);
        const head = await f.backend.readHead();
        const publish = vi.spyOn(f.backend, "publishSnapshot");
        try {
          await assert.rejects(
            syncBoth(f.ctx, { ...mergeOptions, auto }, () => f.backend),
            refusal,
          );
          assert.equal(publish.mock.calls.length, 0);
          assert.deepEqual(await f.backend.readHead(), head);
          assert.deepEqual(await readStateForConfig(f.config), state);
          assert.equal(await readMergeJournal(f.config), undefined);
          assert.equal(await fs.readFile(path.join(root, "agents.md"), "utf8"), original);
          assert.ok(!(await fs.readdir(root)).includes("AGENTS.md"));
        } finally {
          publish.mockRestore();
        }
      }));

for (const deletion of [false, true]) {
  test(`committed journal refuses case-variant ${deletion ? "deletion" : "edit"} and retains evidence`, async () =>
    withTempHome(async (root) => {
      const f = await createMergeFixture(root);
      const state = await readStateForConfig(f.config);
      const { head: committed } = await f.remoteEdit("AGENTS.md", deletion ? undefined : "remote instructions\n");
      const after = await f.backend.readSnapshot(committed.snapshotRef);
      await writeMergeJournal(f.config, {
        version: 1,
        identity: mergeJournalIdentity(f.config, f.backend.identity),
        before: f.base,
        after,
        upload: after,
        expectedHead: f.baseHead,
        committedHead: committed,
        backup: "retained-private-backup",
        stateIdentity: syncStateFingerprint(state),
      });
      await fs.rename(path.join(root, "AGENTS.md"), path.join(root, "agents.md"));
      const evidence = await fs.readFile(mergeJournalPath(f.config), "utf8");
      const publish = vi.spyOn(f.backend, "publishSnapshot");
      try {
        await assert.rejects(
          syncBoth(f.ctx, mergeOptions, () => f.backend),
          refusal,
        );
        assert.equal(publish.mock.calls.length, 0);
        assert.equal(await fs.readFile(mergeJournalPath(f.config), "utf8"), evidence);
        assert.equal(await fs.readFile(path.join(root, "agents.md"), "utf8"), original);
        assert.deepEqual(await readStateForConfig(f.config), state);
        assert.deepEqual(await f.backend.readHead(), committed);
        // Normalizing spelling without changing reviewed bytes permits guarded recovery.
        await fs.rename(path.join(root, "agents.md"), path.join(root, "AGENTS.md"));
        await syncBoth(f.ctx, mergeOptions, () => f.backend);
        assert.equal(await readMergeJournal(f.config), undefined);
        assert.equal(publish.mock.calls.length, 0);
        if (deletion) await assert.rejects(fs.access(path.join(root, "AGENTS.md")), { code: "ENOENT" });
        else assert.equal(await fs.readFile(path.join(root, "AGENTS.md"), "utf8"), "remote instructions\n");
      } finally {
        publish.mockRestore();
      }
    }));

  test(`case variant introduced during journal publication refuses ${deletion ? "deletion" : "edit"}`, async () =>
    withTempHome(async (root) => {
      const f = await createMergeFixture(root);
      await f.remoteEdit("AGENTS.md", deletion ? undefined : "remote instructions\n");
      await fs.writeFile(path.join(root, "settings.json"), '{"theme":"local"}\n');
      const state = await readStateForConfig(f.config);
      const head = await f.backend.readHead();
      const rename = fs.rename.bind(fs);
      let renamed = false;
      const spy = vi.spyOn(fs, "rename").mockImplementation(async (from, to) => {
        await rename(from, to);
        if (!renamed && to === mergeJournalPath(f.config)) {
          renamed = true;
          await rename(path.join(root, "AGENTS.md"), path.join(root, "agents.md"));
        }
      });
      const publish = vi.spyOn(f.backend, "publishSnapshot");
      try {
        await assert.rejects(
          syncBoth(f.ctx, mergeOptions, () => f.backend),
          refusal,
        );
        assert.equal(renamed, true);
        assert.equal(publish.mock.calls.length, 0);
        assert.equal(await readMergeJournal(f.config), undefined);
        assert.equal(await fs.readFile(path.join(root, "agents.md"), "utf8"), original);
        assert.deepEqual(await readStateForConfig(f.config), state);
        assert.deepEqual(await f.backend.readHead(), head);
      } finally {
        spy.mockRestore();
        publish.mockRestore();
      }
    }));
}

for (const relative of BUILT_IN_SYNC_ROOTS.filter((name) => name.includes(".")))
  test(`preflight detects noncanonical physical ${relative}`, async () =>
    withTempHome(async (root) => {
      await fs.mkdir(root, { recursive: true });
      const variant = relative === relative.toLowerCase() ? relative.toUpperCase() : relative.toLowerCase();
      await fs.writeFile(path.join(root, variant), "before");
      const before = snapshot([{ path: relative, content: Buffer.from("before") }]);
      const after = snapshot([{ path: relative, content: Buffer.from("after") }]);
      await assert.rejects(preflightMergedTargets(before, after, {}), refusal);
      assert.equal(await fs.readFile(path.join(root, variant), "utf8"), "before");
    }));

for (const kind of ["directory", "symlink"] as const)
  test(`case-variant ${kind} cannot be mistaken for a missing deletion target`, async () =>
    withTempHome(async (root) => {
      await fs.mkdir(root, { recursive: true });
      const target = path.join(root, "agents.md");
      if (kind === "directory") await fs.mkdir(target);
      else await fs.symlink("missing-resource", target);
      await assert.rejects(
        preflightMergedTargets(snapshot([{ path: "AGENTS.md", content: Buffer.from("before") }]), snapshot([]), {}),
        refusal,
      );
      assert.ok(await fs.lstat(target));
    }));

for (const loss of ["abort", "ownership"] as const)
  for (const missing of [false, true])
    test(`case scan revalidates ${loss} after ${missing ? "ENOENT" : "successful"} directory read`, async () =>
      withTempHome(async (root) => {
        await fs.mkdir(root, { recursive: true });
        const controller = new AbortController();
        let owned = true;
        const readdir = fs.readdir.bind(fs);
        const spy = vi.spyOn(fs, "readdir").mockImplementation(async (...args: Parameters<typeof fs.readdir>) => {
          const result = await readdir(...args);
          if (loss === "abort") controller.abort(new Error("lost ownership"));
          else owned = false;
          if (missing) throw Object.assign(new Error("missing root"), { code: "ENOENT" });
          return result;
        });
        try {
          await assert.rejects(
            preflightMergedTargets(snapshot([]), snapshot([{ path: "AGENTS.md", content: Buffer.from("after") }]), {
              signal: controller.signal,
              validateMutation: () => {
                if (!owned) throw new Error("lost ownership");
              },
            }),
            /lost ownership/,
          );
          assert.deepEqual(await readdir(root), []);
        } finally {
          spy.mockRestore();
        }
      }));

test("unchanged case variants do not prevent independent canonical changes", async () =>
  withTempHome(async (root) => {
    const f = await createMergeFixture(root);
    await fs.rename(path.join(root, "AGENTS.md"), path.join(root, "agents.md"));
    await f.remoteEdit("settings.json", '{"theme":"remote"}\n');
    await syncBoth(f.ctx, mergeOptions, () => f.backend);
    assert.equal(await fs.readFile(path.join(root, "settings.json"), "utf8"), '{"theme":"remote"}\n');
    assert.equal(await fs.readFile(path.join(root, "agents.md"), "utf8"), original);
    assert.equal(await readMergeJournal(f.config), undefined);
  }));

test("merged apply rechecks spelling after awaited validation", async () =>
  withTempHome(async (root) => {
    await fs.mkdir(root, { recursive: true });
    await fs.writeFile(path.join(root, "AGENTS.md"), "before");
    let renamed = false;
    await assert.rejects(
      applyMergedSnapshot(
        snapshot([{ path: "AGENTS.md", content: Buffer.from("before") }]),
        snapshot([]),
        new Set(),
        { include: ["AGENTS.md"] },
        async () => {
          if (!renamed) {
            renamed = true;
            await fs.rename(path.join(root, "AGENTS.md"), path.join(root, "agents.md"));
          }
        },
      ),
      refusal,
    );
    assert.equal(await fs.readFile(path.join(root, "agents.md"), "utf8"), "before");
  }));

for (const incoming of ["concurrent writer", "before", "after"])
  test(`case rename refuses a queued destination writer with ${incoming} bytes`, async () =>
    withTempHome(async (root) => {
      await fs.mkdir(path.join(root, "prompts"), { recursive: true });
      const source = path.join(root, "prompts/Foo.md");
      const destination = path.join(root, "prompts/foo.md");
      await fs.writeFile(source, "before");
      const realpath = fs.realpath.bind(fs);
      vi.spyOn(fs, "realpath").mockImplementation(async (target, ...args) => {
        if (String(target) === destination) {
          try {
            return await realpath(source, ...args);
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
          }
        }
        return realpath(target, ...args);
      });
      const rm = fs.rm.bind(fs);
      let writer: Promise<void> | undefined;
      vi.spyOn(fs, "rm").mockImplementation(async (target, options) => {
        await rm(target, options);
        if (String(target) === source) {
          writer = withFileMutationQueue(destination, async () => {
            await fs.writeFile(destination, incoming);
          });
          await writer;
        }
      });
      await assert.rejects(
        applyMergedSnapshot(
          snapshot([{ path: "prompts/Foo.md", content: Buffer.from("before") }]),
          snapshot([{ path: "prompts/foo.md", content: Buffer.from("after") }]),
          new Set(),
          { include: ["prompts"] },
          async () => {},
        ),
        /destination changed before queue reservation/,
      );
      assert.ok(writer);
      await writer;
      assert.equal(await fs.readFile(destination, "utf8"), incoming);
    }));
