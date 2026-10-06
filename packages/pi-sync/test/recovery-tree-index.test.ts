import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { test, vi } from "vitest";
import { recoverPendingSnapshotTransactions } from "../src/snapshot/snapshot-transaction.js";
import { withTempHome } from "./helpers.js";

const fileImage = (value: string) => `file:${createHash("sha256").update(value).digest("hex")}`;

for (const shape of ["wide", "deep"] as const)
  test(`recovery indexes ${shape} directory prefixes and hashes each live leaf at most twice per verification`, async () =>
    withTempHome(async (agentDir) => {
      const target = path.join(agentDir, "tree");
      const directory = path.join(agentDir, "pi-sync/transactions/pending");
      await fs.mkdir(path.join(directory, "before"), { recursive: true });
      await fs.writeFile(path.join(directory, "before/0"), "before");
      const relatives =
        shape === "wide"
          ? Array.from({ length: 80 }, (_, i) => path.join(`dir-${i}`, "leaf"))
          : [path.join(...Array.from({ length: 40 }, (_, i) => `dir-${i}`), "leaf")];
      const live = new Set(relatives.map((relative) => path.join(target, relative)));
      for (const file of live) {
        await fs.mkdir(path.dirname(file), { recursive: true });
        await fs.writeFile(file, "after");
      }
      // One absent expected leaf makes the complete tree refuse after walking all present nodes.
      const postFiles = [...relatives, "missing"].map((relative) => ({ relative, image: fileImage("after") }));
      await fs.writeFile(
        path.join(directory, "journal.json"),
        JSON.stringify({
          version: 4,
          root: agentDir,
          entries: [
            {
              target,
              backupName: "0",
              kind: "file",
              beforeImage: fileImage("before"),
              afterImage: "missing",
              postFiles,
              replacementStarted: true,
            },
          ],
        }),
      );
      const read = fs.readFile.bind(fs);
      const counts = new Map<string, number>();
      const reader = vi.spyOn(fs, "readFile").mockImplementation(async (...args) => {
        const file = String(args[0]);
        if (live.has(file)) counts.set(file, (counts.get(file) ?? 0) + 1);
        return read(...args);
      });
      const keys = vi.spyOn(Map.prototype, "keys");
      try {
        await assert.rejects(recoverPendingSnapshotTransactions(), /newer bytes/);
        assert.equal(counts.size, live.size);
        for (const count of counts.values()) assert.equal(count, 2);
        assert.ok(keys.mock.calls.length <= 4, `expected constant key enumerations, got ${keys.mock.calls.length}`);
        await fs.access(path.join(directory, "journal.json"));
      } finally {
        reader.mockRestore();
        keys.mockRestore();
      }
    }));
