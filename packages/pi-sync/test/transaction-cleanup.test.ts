import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { test, vi } from "vitest";
import { applySnapshotTransaction, recoverPendingSnapshotTransactions } from "../src/snapshot/snapshot-transaction.js";
import { withTempHome } from "./helpers.js";

const fileImage = (value: string) => `file:${createHash("sha256").update(value).digest("hex")}`;

for (const operation of ["apply", "recover"] as const)
  for (const survives of [false, true])
    test(`${operation} accepts durable files on cleanup fsync failure (surviving evidence: ${survives})`, async () =>
      withTempHome(async (agentDir) => {
        const root = path.join(agentDir, "pi-sync/transactions");
        const target = path.join(agentDir, "AGENTS.md");
        await fs.mkdir(agentDir, { recursive: true });
        await fs.writeFile(target, "before");
        if (operation === "recover") {
          const directory = path.join(root, "pending");
          await fs.mkdir(path.join(directory, "before"), { recursive: true });
          await fs.writeFile(path.join(directory, "before/0"), "before");
          await fs.writeFile(target, "after");
          await fs.writeFile(
            path.join(directory, "journal.json"),
            JSON.stringify({
              version: 2,
              root: agentDir,
              entries: [
                {
                  target,
                  backupName: "0",
                  kind: "file",
                  beforeImage: fileImage("before"),
                  afterImage: fileImage("after"),
                  postFiles: [],
                },
              ],
            }),
          );
        }
        let deleted = false;
        let failures = 0;
        const rm = fs.rm.bind(fs);
        const open = fs.open.bind(fs);
        const remove = vi.spyOn(fs, "rm").mockImplementation(async (file, options) => {
          if (path.dirname(String(file)) === root) {
            deleted = true;
            if (survives) return;
          }
          await rm(file, options);
        });
        const sync = vi.spyOn(fs, "open").mockImplementation(async (...args) => {
          if (deleted && String(args[0]) === root) {
            failures++;
            throw new Error("injected cleanup fsync failure");
          }
          return open(...args);
        });
        try {
          if (operation === "apply")
            await applySnapshotTransaction({ deletes: [], writes: [{ target, content: Buffer.from("after") }] });
          else await recoverPendingSnapshotTransactions();
          assert.equal(failures, process.platform === "win32" ? 0 : 1);
          assert.equal(await fs.readFile(target, "utf8"), operation === "apply" ? "after" : "before");
          if (!survives) assert.deepEqual(await fs.readdir(root), []);
          else {
            const directories = await fs.readdir(root);
            assert.equal(directories.length, 1);
            const journal = JSON.parse(
              await fs.readFile(path.join(root, directories[0] as string, "journal.json"), "utf8"),
            );
            assert.equal(journal.version, 6);
            assert.equal(journal.completed, true);
            remove.mockRestore();
            sync.mockRestore();
            await fs.writeFile(target, "newer external bytes");
            await recoverPendingSnapshotTransactions({ protectedTargets: [target] });
            assert.equal(await fs.readFile(target, "utf8"), "newer external bytes");
            assert.deepEqual(await fs.readdir(root), []);
          }
        } finally {
          remove.mockRestore();
          sync.mockRestore();
        }
      }));

test("cleanup deletion failure does not enter rollback or claim retained backups", async () =>
  withTempHome(async (agentDir) => {
    const root = path.join(agentDir, "pi-sync/transactions");
    const target = path.join(agentDir, "AGENTS.md");
    await fs.mkdir(agentDir, { recursive: true });
    await fs.writeFile(target, "before");
    const rm = fs.rm.bind(fs);
    const remove = vi.spyOn(fs, "rm").mockImplementation(async (file, options) => {
      if (path.dirname(String(file)) === root) {
        await rm(file, options);
        throw new Error("injected evidence deletion failure");
      }
      return rm(file, options);
    });
    try {
      await assert.rejects(
        applySnapshotTransaction({ deletes: [], writes: [{ target, content: Buffer.from("after") }] }),
        (error: unknown) => {
          assert.ok(error instanceof Error);
          assert.equal(error.message, "injected evidence deletion failure");
          return true;
        },
      );
      assert.equal(await fs.readFile(target, "utf8"), "after");
    } finally {
      remove.mockRestore();
    }
  }));
