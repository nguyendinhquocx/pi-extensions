import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { test, vi } from "vitest";
import { applySnapshotTransaction, recoverPendingSnapshotTransactions } from "../src/snapshot/snapshot-transaction.js";
import { fileImage } from "../src/snapshot/snapshot-transaction-plan.js";
import { withTempHome } from "./helpers.js";

async function evidence(root: string) {
  const transactions = path.join(root, "pi-sync/transactions");
  const names = await fs.readdir(transactions);
  assert.equal(names.length, 1);
  const directory = path.join(transactions, names[0] ?? "");
  const file = path.join(directory, "journal.json");
  return { directory, file, journal: JSON.parse(await fs.readFile(file, "utf8")) };
}

for (const shape of ["directory-to-file", "file-to-directory"] as const)
  for (const deletion of ["none", "root", "child"] as const) {
    if (shape === "directory-to-file" && deletion === "child") continue;
    test(`${shape} committed replacement preserves later ${deletion} deletion`, async () =>
      withTempHome(async (root) => {
        await fs.mkdir(root, { recursive: true });
        const target = path.join(root, "custom");
        const child = path.join(target, "new.md");
        if (shape === "directory-to-file") {
          await fs.mkdir(target);
          await fs.writeFile(path.join(target, "old.md"), "before");
        } else await fs.writeFile(target, "before");
        const controller = new AbortController();
        const rename = fs.rename.bind(fs);
        let atRename:
          | { version: number; entry: { removalPending?: boolean; replacementStarted?: boolean } }
          | undefined;
        const spy = vi.spyOn(fs, "rename").mockImplementation(async (from, to) => {
          if (to === (shape === "directory-to-file" ? target : child)) {
            const saved = await evidence(root);
            atRename = {
              version: saved.journal.version,
              entry: saved.journal.entries.find((e: { target: string }) => e.target === target),
            };
            await rename(from, to);
            controller.abort();
            return;
          }
          return rename(from, to);
        });
        try {
          await assert.rejects(
            applySnapshotTransaction(
              {
                deletes: [target],
                writes: [{ target: shape === "directory-to-file" ? target : child, content: Buffer.from("after") }],
              },
              { signal: controller.signal },
            ),
            /cancelled/,
          );
        } finally {
          spy.mockRestore();
        }
        if (deletion !== "none") {
          await fs.rm(deletion === "child" ? child : target, { recursive: true });
          const saved = await evidence(root);
          await assert.rejects(recoverPendingSnapshotTransactions(), /newer bytes/);
          await fs.access(saved.file);
          assert.equal(
            await fs.readFile(
              path.join(saved.directory, "before/0", shape === "directory-to-file" ? "old.md" : ""),
              "utf8",
            ),
            "before",
          );
          if (deletion === "child") assert.deepEqual(await fs.readdir(target), []);
          else await assert.rejects(fs.access(target), { code: "ENOENT" });
        } else {
          await recoverPendingSnapshotTransactions();
          assert.equal(
            await fs.readFile(shape === "directory-to-file" ? path.join(target, "old.md") : target, "utf8"),
            "before",
          );
          assert.deepEqual(await fs.readdir(path.join(root, "pi-sync/transactions")), []);
        }
        assert.ok(atRename);
        assert.equal(atRename.version, 4);
        assert.equal(atRename.entry.removalPending, false);
        assert.equal(atRename.entry.replacementStarted, true);
      }));
  }

for (const kind of ["directory", "file", "symlink"] as const)
  test(`committed ${kind} restoration never resurrects an externally deleted preimage`, async () =>
    withTempHome(async (root) => {
      const target = path.join(root, "custom");
      const directory = path.join(root, "pi-sync/transactions/interrupted");
      await fs.mkdir(path.join(directory, "before/0"), { recursive: true });
      let beforeImage: string;
      let postFiles: { relative: string; image: string }[] = [];
      if (kind === "directory") {
        await fs.writeFile(path.join(directory, "before/0/old.md"), "before");
        // Use the transaction's directory image format without coupling to its private parser.
        const { createHash } = await import("node:crypto");
        beforeImage = `directory:${createHash("sha256")
          .update(JSON.stringify([["old.md", fileImage(Buffer.from("before"))]]))
          .digest("hex")}`;
        await fs.writeFile(target, "after");
      } else if (kind === "file") {
        await fs.rm(path.join(directory, "before/0"), { recursive: true });
        await fs.writeFile(path.join(directory, "before/0"), "before");
        beforeImage = fileImage(Buffer.from("before"));
        await fs.mkdir(target);
        await fs.writeFile(path.join(target, "after.md"), "after");
        postFiles = [{ relative: "after.md", image: fileImage(Buffer.from("after")) }];
      } else {
        beforeImage = "symlink:old.md";
        await fs.writeFile(target, "after");
      }
      await fs.writeFile(
        path.join(directory, "journal.json"),
        JSON.stringify({
          version: 2,
          root,
          entries: [
            {
              target,
              backupName: "0",
              kind,
              beforeImage,
              afterImage: kind === "file" ? "missing" : fileImage(Buffer.from("after")),
              postFiles,
              ...(kind === "symlink" ? { linkTarget: "old.md" } : {}),
            },
          ],
        }),
      );
      const controller = new AbortController();
      const rename = fs.rename.bind(fs);
      let captured: { removalPending?: boolean; replacementStarted?: boolean } | undefined;
      const spy = vi.spyOn(fs, "rename").mockImplementation(async (from, to) => {
        if (to === target) {
          captured = (await evidence(root)).journal.entries[0];
          await rename(from, to);
          controller.abort();
          return;
        }
        return rename(from, to);
      });
      try {
        await assert.rejects(recoverPendingSnapshotTransactions({ signal: controller.signal }), /abort/i);
      } finally {
        spy.mockRestore();
      }
      await fs.rm(target, { recursive: true });
      await assert.rejects(recoverPendingSnapshotTransactions(), /newer bytes/);
      await assert.rejects(fs.access(target), { code: "ENOENT" });
      await fs.access(path.join(directory, "journal.json"));
      assert.ok(captured);
      assert.equal(captured.removalPending, false);
      assert.equal(captured.replacementStarted, true);
    }));

for (const version of [2, 3])
  test(`legacy version ${version} cannot authorize an ambiguous missing replacement`, async () =>
    withTempHome(async (root) => {
      const target = path.join(root, "custom");
      const directory = path.join(root, "pi-sync/transactions/interrupted");
      await fs.mkdir(path.join(directory, "before/0"), { recursive: true });
      await fs.writeFile(path.join(directory, "before/0/old.md"), "before");
      const { createHash } = await import("node:crypto");
      await fs.writeFile(
        path.join(directory, "journal.json"),
        JSON.stringify({
          version,
          root,
          entries: [
            {
              target,
              backupName: "0",
              kind: "directory",
              beforeImage: `directory:${createHash("sha256")
                .update(JSON.stringify([["old.md", fileImage(Buffer.from("before"))]]))
                .digest("hex")}`,
              afterImage: fileImage(Buffer.from("after")),
              postFiles: [],
              ...(version === 3 ? { removalPending: true } : {}),
            },
          ],
        }),
      );
      await assert.rejects(recoverPendingSnapshotTransactions(), /newer bytes/);
      await assert.rejects(fs.access(target), { code: "ENOENT" });
      await fs.access(directory);
    }));

test("failed durable retirement never starts replacement and preserves provably pre-installation evidence", async () =>
  withTempHome(async (root) => {
    const target = path.join(root, "custom");
    await fs.mkdir(target, { recursive: true });
    await fs.writeFile(path.join(target, "old.md"), "before");
    const rename = fs.rename.bind(fs);
    let failed = false;
    let installed = false;
    const spy = vi.spyOn(fs, "rename").mockImplementation(async (from, to) => {
      if (String(to).endsWith("journal.json")) {
        const candidate = JSON.parse(await fs.readFile(from, "utf8"));
        if (candidate.entries.some((e: { replacementStarted?: boolean }) => e.replacementStarted)) {
          failed = true;
          throw new Error("injected retirement publication failure");
        }
      }
      if (to === target) installed = true;
      return rename(from, to);
    });
    try {
      await assert.rejects(
        applySnapshotTransaction({ deletes: [target], writes: [{ target, content: Buffer.from("after") }] }),
      );
      assert.equal(failed, true);
      assert.equal(installed, false);
    } finally {
      spy.mockRestore();
    }
    const saved = await evidence(root);
    assert.equal(saved.journal.version, 4);
    assert.equal(saved.journal.entries[0].removalPending, true);
    await recoverPendingSnapshotTransactions();
    assert.equal(await fs.readFile(path.join(target, "old.md"), "utf8"), "before");
  }));

for (const invalid of ["type", "conflict"] as const)
  test(`replacement evidence refuses invalid ${invalid} without mutation`, async () =>
    withTempHome(async (root) => {
      const target = path.join(root, "custom");
      const directory = path.join(root, "pi-sync/transactions/interrupted");
      await fs.mkdir(path.join(directory, "before"), { recursive: true });
      await fs.writeFile(path.join(directory, "before/0"), "before");
      await fs.writeFile(target, "after");
      await fs.writeFile(
        path.join(directory, "journal.json"),
        JSON.stringify({
          version: 4,
          root,
          entries: [
            {
              target,
              backupName: "0",
              kind: "file",
              beforeImage: fileImage(Buffer.from("before")),
              afterImage: fileImage(Buffer.from("after")),
              postFiles: [],
              replacementStarted: invalid === "type" ? "yes" : true,
              ...(invalid === "conflict" ? { removalPending: true } : {}),
            },
          ],
        }),
      );
      await assert.rejects(recoverPendingSnapshotTransactions(), /replacement evidence/);
      assert.equal(await fs.readFile(target, "utf8"), "after");
      await fs.access(directory);
    }));

for (const guard of ["abort", "owner"] as const)
  test(`durable retirement revalidates ${guard} before installation`, async () =>
    withTempHome(async (root) => {
      const target = path.join(root, "custom");
      await fs.mkdir(target, { recursive: true });
      await fs.writeFile(path.join(target, "old.md"), "before");
      const controller = new AbortController();
      let current = true;
      let installed = false;
      let retired = false;
      const rename = fs.rename.bind(fs);
      const spy = vi.spyOn(fs, "rename").mockImplementation(async (from, to) => {
        if (String(to).endsWith("journal.json")) {
          const candidate = JSON.parse(await fs.readFile(from, "utf8"));
          if (candidate.entries.some((entry: { replacementStarted?: boolean }) => entry.replacementStarted)) {
            await rename(from, to);
            retired = true;
            if (guard === "abort") controller.abort();
            else current = false;
            return;
          }
        }
        if (to === target) installed = true;
        return rename(from, to);
      });
      try {
        await assert.rejects(
          applySnapshotTransaction(
            { deletes: [target], writes: [{ target, content: Buffer.from("after") }] },
            {
              signal: controller.signal,
              validateMutation: () => {
                if (!current) throw new Error("stale owner");
              },
            },
          ),
          /cancelled|requires review/,
        );
      } finally {
        spy.mockRestore();
      }
      assert.equal(retired, true);
      assert.equal(installed, false);
      await assert.rejects(recoverPendingSnapshotTransactions(), /newer bytes/);
      await assert.rejects(fs.access(target), { code: "ENOENT" });
      await evidence(root);
    }));
