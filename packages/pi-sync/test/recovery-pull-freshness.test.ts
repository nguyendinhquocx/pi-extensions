import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { test, vi } from "vitest";
import { readStateForConfig, syncStateFingerprint } from "../src/state/sync-state-store.js";
import { mergeJournalIdentity, mergeJournalPath, writeMergeJournal } from "../src/sync/merge-journal.js";
import { pull } from "../src/sync/sync-mutations.js";
import { withTempHome } from "./helpers.js";
import { createMergeFixture, mergeOptions } from "./merged-sync-fixture.js";

for (const boundary of ["backup-file", "backup-directory", "session-root"] as const)
  for (const change of ["edit", "delete", "remote"] as const)
    test(`recovery pull refuses ${change} during ${boundary}`, async () =>
      withTempHome(async (root) => {
        const f = await createMergeFixture(root);
        await f.remoteEdit("AGENTS.md", "remote instructions");
        const state = await readStateForConfig(f.config);
        await writeMergeJournal(f.config, {
          version: 1,
          identity: mergeJournalIdentity(f.config, f.backend.identity),
          before: f.base,
          after: f.base,
          upload: f.base,
          expectedHead: f.baseHead,
          backup: "retained-private-backup",
          stateIdentity: syncStateFingerprint(state),
        });
        const journal = await fs.readFile(mergeJournalPath(f.config));
        const target = path.join(root, "AGENTS.md");
        let mutated = false;
        let backedUp = false;
        const mutate = async () => {
          if (mutated) return;
          mutated = true;
          if (change === "edit") await fs.writeFile(target, "late local bytes");
          else if (change === "delete") await fs.rm(target);
          else await f.remoteEdit("AGENTS.md", "late remote bytes");
        };
        const open = fs.open.bind(fs);
        const read = fs.readFile.bind(fs);
        const opening = vi.spyOn(fs, "open").mockImplementation(async (...args) => {
          const file = String(args[0]);
          if (file.endsWith(".json.gz")) {
            backedUp = true;
            if (boundary === "backup-file") await mutate();
          }
          if (boundary === "backup-directory" && backedUp && file === path.join(root, "pi-sync/backups"))
            await mutate();
          return open(...args);
        });
        const reading = vi.spyOn(fs, "readFile").mockImplementation(async (...args) => {
          const result = await read(...args);
          if (boundary === "session-root" && backedUp && String(args[0]) === path.join(root, "settings.json"))
            await mutate();
          return result;
        });
        let commits = 0;
        try {
          await assert.rejects(
            pull(
              f.ctx,
              {
                ...mergeOptions,
                force: true,
                onCommit: () => {
                  commits++;
                },
              },
              () => f.backend,
            ),
            /changed during recovery review/,
          );
          assert.equal(mutated, true);
          assert.equal(commits, 0);
          assert.deepEqual(await fs.readFile(mergeJournalPath(f.config)), journal);
          assert.deepEqual(await readStateForConfig(f.config), state);
          if (change === "delete") await assert.rejects(fs.access(target), { code: "ENOENT" });
          else
            assert.equal(
              await fs.readFile(target, "utf8"),
              change === "edit" ? "late local bytes" : "original instructions\n",
            );
          await assert.rejects(fs.access(path.join(root, "pi-sync/transactions")), { code: "ENOENT" });
        } finally {
          opening.mockRestore();
          reading.mockRestore();
        }
      }));
