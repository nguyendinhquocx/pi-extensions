import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { test, vi } from "vitest";
import { readStateForConfig, writeStateForConfig } from "../src/state/sync-state-store.js";
import { mergeJournalPath } from "../src/sync/merge-journal.js";
import { mergeSync } from "../src/sync/merged-sync.js";
import { withTempHome } from "./helpers.js";
import { createMergeFixture, mergeOptions } from "./merged-sync-fixture.js";

for (const mode of ["unchanged", "local-changed", "baseline-changed", "committed", "unsupported"] as const) {
  test(`legacy read revision recovery: ${mode}`, async () =>
    withTempHome(async (agentDir) => {
      const f = await createMergeFixture(agentDir);
      await fs.writeFile(path.join(agentDir, "AGENTS.md"), "local edit\n");
      await f.remoteEdit("settings.json", '{"theme":"remote"}\n');
      const head = await f.backend.readHead();
      assert.ok(head);
      const publish = vi.spyOn(f.backend, "publishSnapshot").mockRejectedValueOnce(new Error("interrupted"));
      await assert.rejects(
        mergeSync(f.ctx, mergeOptions, () => f.backend),
        /interrupted/u,
      );
      const file = mergeJournalPath(f.config);
      const journal = JSON.parse(await fs.readFile(file, "utf8"));
      journal.expectedHead.revision = "legacy-read-revision";
      if (mode === "committed") journal.committedHead = { ...head, snapshotId: journal.upload.id };
      await fs.writeFile(file, JSON.stringify(journal));
      const evidence = await fs.readFile(file);
      const matches = vi.fn(() => true);
      if (mode !== "unsupported") Object.assign(f.backend, { matchesUncommittedRecoveryHead: matches });
      if (mode === "local-changed") await fs.writeFile(path.join(agentDir, "AGENTS.md"), "newer edit\n");
      if (mode === "baseline-changed") {
        const state = await readStateForConfig(f.config);
        await writeStateForConfig(f.config, { ...state, lastAppliedSnapshot: "newer-baseline" });
      }
      if (mode === "unchanged") {
        assert.equal(await mergeSync(f.ctx, mergeOptions, () => f.backend), "cancelled");
        await assert.rejects(fs.access(file), { code: "ENOENT" });
      } else {
        await assert.rejects(
          mergeSync(f.ctx, mergeOptions, () => f.backend),
          /local content or baseline changed|cannot be reconciled/u,
        );
        assert.deepEqual(await fs.readFile(file), evidence);
      }
      assert.equal(matches.mock.calls.length, mode === "committed" || mode === "unsupported" ? 0 : 1);
      assert.equal(publish.mock.calls.length, 1);
      assert.deepEqual(await f.backend.readHead(), head);
      await fs.access(journal.backup);
      assert.equal(
        await fs.readFile(path.join(agentDir, "AGENTS.md"), "utf8"),
        mode === "local-changed" ? "newer edit\n" : "local edit\n",
      );
    }));
}
