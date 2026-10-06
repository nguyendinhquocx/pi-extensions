import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { test, vi } from "vitest";
import { applySnapshotTransaction, recoverPendingSnapshotTransactions } from "../src/snapshot/snapshot-transaction.js";
import { withTempHome } from "./helpers.js";

const fileImage = (value: string) => `file:${createHash("sha256").update(value).digest("hex")}`;
async function journalFixture(agentDir: string, version = 2, current = "after") {
  const directory = path.join(agentDir, "pi-sync/transactions/interrupted");
  const target = path.join(agentDir, "AGENTS.md");
  await fs.mkdir(path.join(directory, "before"), { recursive: true });
  await fs.writeFile(path.join(directory, "before/0"), "before");
  await fs.writeFile(target, current);
  await fs.writeFile(
    path.join(directory, "journal.json"),
    JSON.stringify({
      version,
      root: agentDir,
      entries: [
        {
          target,
          backupName: "0",
          kind: "file",
          ...(version === 2 ? { beforeImage: fileImage("before"), afterImage: fileImage("after"), postFiles: [] } : {}),
        },
      ],
    }),
  );
  return { directory, target };
}

for (const current of ["before", "after"])
  test(`guarded v2 recovery accepts the ${current} image`, async () =>
    withTempHome(async (agentDir) => {
      const f = await journalFixture(agentDir, 2, current);
      await recoverPendingSnapshotTransactions();
      assert.equal(await fs.readFile(f.target, "utf8"), "before");
      await assert.rejects(fs.access(f.directory), { code: "ENOENT" });
    }));

for (const version of [1, 2])
  test(`v${version} recovery never overwrites newer external bytes`, async () =>
    withTempHome(async (agentDir) => {
      const f = await journalFixture(agentDir, version, "external");
      await assert.rejects(recoverPendingSnapshotTransactions(), /newer bytes/);
      assert.equal(await fs.readFile(f.target, "utf8"), "external");
      assert.equal(await fs.readFile(path.join(f.directory, "before/0"), "utf8"), "before");
      await fs.access(path.join(f.directory, "journal.json"));
    }));

test("legacy v1 recovery only retires a provably unchanged preimage", async () =>
  withTempHome(async (agentDir) => {
    const f = await journalFixture(agentDir, 1, "before");
    await recoverPendingSnapshotTransactions();
    assert.equal(await fs.readFile(f.target, "utf8"), "before");
    await assert.rejects(fs.access(f.directory), { code: "ENOENT" });
  }));

test("current-session protection precedes transaction restoration", async () =>
  withTempHome(async (agentDir) => {
    const f = await journalFixture(agentDir);
    await assert.rejects(recoverPendingSnapshotTransactions({ protectedTargets: [f.target] }), /current session/);
    assert.equal(await fs.readFile(f.target, "utf8"), "after");
    await fs.access(f.directory);
  }));

test("unowned roots, missing backups and malformed private journals fail without content disclosure", async () =>
  withTempHome(async (agentDir) => {
    const f = await journalFixture(agentDir);
    const file = path.join(f.directory, "journal.json");
    const original = JSON.parse(await fs.readFile(file, "utf8"));
    await fs.writeFile(
      file,
      JSON.stringify({
        ...original,
        sessionRoot: path.dirname(agentDir),
        entries: [{ ...original.entries[0], target: path.join(path.dirname(agentDir), "unowned-session.jsonl") }],
      }),
    );
    await assert.rejects(recoverPendingSnapshotTransactions(), /not owned/);
    await fs.writeFile(file, JSON.stringify(original));
    await fs.rm(path.join(f.directory, "before/0"));
    await assert.rejects(recoverPendingSnapshotTransactions(), /backup is missing/);
    await fs.writeFile(file, '{"private":"sensitive-sentinel",');
    await assert.rejects(recoverPendingSnapshotTransactions(), (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.doesNotMatch(error.message, /sensitive-sentinel/);
      assert.equal(error.cause, undefined);
      return true;
    });
    assert.equal(await fs.readFile(f.target, "utf8"), "after");
  }));

for (const external of [false, true])
  test(`failed local apply ${external ? "preserves external edits" : "restores only proven postimages"}`, async () =>
    withTempHome(async (agentDir) => {
      await fs.mkdir(agentDir, { recursive: true });
      const first = path.join(agentDir, "AGENTS.md");
      const second = path.join(agentDir, "APPEND_SYSTEM.md");
      await fs.writeFile(first, "first before");
      await fs.writeFile(second, "second before");
      const rename = fs.rename.bind(fs);
      const spy = vi.spyOn(fs, "rename").mockImplementation(async (from, to) => {
        if (String(from).endsWith(".apply") && to === second) {
          if (external) await fs.writeFile(first, "external first");
          throw new Error("injected apply failure");
        }
        return rename(from, to);
      });
      try {
        await assert.rejects(
          applySnapshotTransaction({
            writes: [
              { target: first, content: Buffer.from("first after") },
              { target: second, content: Buffer.from("second after") },
            ],
            deletes: [],
          }),
          external ? /guarded recovery requires review/ : /injected/,
        );
        assert.equal(await fs.readFile(first, "utf8"), external ? "external first" : "first before");
        assert.equal(await fs.readFile(second, "utf8"), "second before");
        const entries = await fs.readdir(path.join(agentDir, "pi-sync/transactions"));
        assert.equal(entries.length, external ? 1 : 0);
      } finally {
        spy.mockRestore();
      }
    }));

test("cancelled owner retains complete atomic postimages for a later guarded recovery", async () =>
  withTempHome(async (agentDir) => {
    await fs.mkdir(agentDir, { recursive: true });
    const target = path.join(agentDir, "AGENTS.md");
    await fs.writeFile(target, "before");
    const controller = new AbortController();
    const rename = fs.rename.bind(fs);
    const spy = vi.spyOn(fs, "rename").mockImplementation(async (from, to) => {
      await rename(from, to);
      if (String(from).endsWith(".apply")) controller.abort();
    });
    try {
      await assert.rejects(
        applySnapshotTransaction(
          { writes: [{ target, content: Buffer.from("after") }], deletes: [] },
          { signal: controller.signal },
        ),
        /cancelled/,
      );
      assert.equal(await fs.readFile(target, "utf8"), "after");
    } finally {
      spy.mockRestore();
    }
    await recoverPendingSnapshotTransactions();
    assert.equal(await fs.readFile(target, "utf8"), "before");
  }));

for (const kind of ["missing", "directory", "symlink"] as const)
  test(`${kind} recovery rechecks newer bytes at its removal boundary`, async () =>
    withTempHome(async (agentDir) => {
      const f = await journalFixture(agentDir);
      let beforeImage = "missing";
      if (kind === "directory") {
        await fs.rm(path.join(f.directory, "before/0"));
        await fs.mkdir(path.join(f.directory, "before/0"));
        await fs.writeFile(path.join(f.directory, "before/0/old.md"), "before");
        beforeImage = `directory:${createHash("sha256")
          .update(JSON.stringify([["old.md", fileImage("before")]]))
          .digest("hex")}`;
      } else if (kind === "symlink") beforeImage = "symlink:old-target";
      await fs.writeFile(
        path.join(f.directory, "journal.json"),
        JSON.stringify({
          version: 2,
          root: agentDir,
          entries: [
            {
              target: f.target,
              backupName: "0",
              kind,
              linkTarget: "old-target",
              beforeImage,
              afterImage: fileImage("after"),
              postFiles: [],
            },
          ],
        }),
      );
      let guards = 0;
      await assert.rejects(
        recoverPendingSnapshotTransactions({
          validateMutation: () => {
            if (++guards !== 2) return;
            // External writer arrives after the iteration's image checks, before removal.
            rmSync(f.target);
            mkdirSync(f.target);
            writeFileSync(path.join(f.target, "newer.md"), "newer external bytes");
          },
        }),
        /newer bytes/,
      );
      assert.equal(await fs.readFile(path.join(f.target, "newer.md"), "utf8"), "newer external bytes");
      await fs.access(path.join(f.directory, "journal.json"));
      await fs.access(path.join(f.directory, "before/0"));
    }));

test("recovery observes the live target after hashing a large directory backup", async () =>
  withTempHome(async (agentDir) => {
    const f = await journalFixture(agentDir);
    await fs.rm(path.join(f.directory, "before/0"));
    await fs.mkdir(path.join(f.directory, "before/0"));
    const backup = path.join(f.directory, "before/0/old.md");
    await fs.writeFile(backup, "before");
    const beforeImage = `directory:${createHash("sha256")
      .update(JSON.stringify([["old.md", fileImage("before")]]))
      .digest("hex")}`;
    await fs.writeFile(
      path.join(f.directory, "journal.json"),
      JSON.stringify({
        version: 2,
        root: agentDir,
        entries: [
          {
            target: f.target,
            backupName: "0",
            kind: "directory",
            beforeImage,
            afterImage: fileImage("after"),
            postFiles: [],
          },
        ],
      }),
    );
    const readFile = fs.readFile.bind(fs);
    let reads = 0;
    const spy = vi.spyOn(fs, "readFile").mockImplementation(async (...args) => {
      const result = await readFile(...args);
      if (args[0] === backup && ++reads === 3) await fs.writeFile(f.target, "newer during backup hashing");
      return result;
    });
    try {
      await assert.rejects(recoverPendingSnapshotTransactions(), /newer bytes/);
      assert.equal(await fs.readFile(f.target, "utf8"), "newer during backup hashing");
      await fs.access(path.join(f.directory, "journal.json"));
      assert.equal(await fs.readFile(backup, "utf8"), "before");
    } finally {
      spy.mockRestore();
    }
  }));

test("startup recovery trusts a pinned new session root even while settings still contain the old root", async () =>
  withTempHome(async (agentDir) => {
    await fs.mkdir(agentDir, { recursive: true });
    const oldRoot = path.join(agentDir, "sessions");
    const newRoot = path.join(path.dirname(agentDir), "reviewed-sessions");
    const settings = path.join(agentDir, "settings.json");
    const session = path.join(newRoot, "active.jsonl");
    await fs.writeFile(settings, JSON.stringify({ sessionDir: oldRoot }));
    await fs.mkdir(newRoot, { recursive: true });
    const controller = new AbortController();
    const rename = fs.rename.bind(fs);
    const spy = vi.spyOn(fs, "rename").mockImplementation(async (from, to) => {
      await rename(from, to);
      if (String(to).endsWith("journal.json")) controller.abort();
    });
    try {
      await assert.rejects(
        applySnapshotTransaction(
          {
            deletes: [],
            writes: [
              { target: settings, content: Buffer.from(JSON.stringify({ sessionDir: newRoot })) },
              { target: session, content: Buffer.from("new session") },
            ],
          },
          { sessionDir: newRoot, signal: controller.signal },
        ),
        /cancelled|aborted/i,
      );
    } finally {
      spy.mockRestore();
    }
    await recoverPendingSnapshotTransactions();
    assert.equal(JSON.parse(await fs.readFile(settings, "utf8")).sessionDir, oldRoot);
    await assert.rejects(fs.access(session), { code: "ENOENT" });
    assert.deepEqual(await fs.readdir(path.join(agentDir, "pi-sync/transactions")), []);
  }));

test("startup recovery uses a pinned settings backup when the transactional postimage is malformed", async () =>
  withTempHome(async (agentDir) => {
    await fs.mkdir(agentDir, { recursive: true });
    const settings = path.join(agentDir, "settings.json");
    const sessionRoot = path.join(path.dirname(agentDir), "external-sessions");
    await fs.writeFile(settings, JSON.stringify({ sessionDir: sessionRoot }));
    const controller = new AbortController();
    const rename = fs.rename.bind(fs);
    const spy = vi.spyOn(fs, "rename").mockImplementation(async (from, to) => {
      await rename(from, to);
      if (String(from).endsWith(".apply") && to === settings) controller.abort();
    });
    try {
      await assert.rejects(
        applySnapshotTransaction(
          { deletes: [], writes: [{ target: settings, content: Buffer.from("{invalid") }] },
          { sessionDir: sessionRoot, signal: controller.signal },
        ),
        /cancelled/,
      );
    } finally {
      spy.mockRestore();
    }
    assert.equal(await fs.readFile(settings, "utf8"), "{invalid");
    await recoverPendingSnapshotTransactions();
    assert.equal(JSON.parse(await fs.readFile(settings, "utf8")).sessionDir, sessionRoot);
  }));

test("directional directory-to-file replacement does not re-delete descendants", async () =>
  withTempHome(async (agentDir) => {
    const root = path.join(agentDir, "custom");
    const child = path.join(root, "old.md");
    await fs.mkdir(root, { recursive: true });
    await fs.writeFile(child, "old");
    await applySnapshotTransaction({
      deletes: [root, child],
      writes: [{ target: root, content: Buffer.from("replacement") }],
    });
    assert.equal(await fs.readFile(root, "utf8"), "replacement");
  }));

for (const fail of [false, true])
  test(`file-to-directory ${fail ? "interruption review" : "apply"} retains safe structure`, async () =>
    withTempHome(async (agentDir) => {
      await fs.mkdir(agentDir, { recursive: true });
      const root = path.join(agentDir, "custom");
      const first = path.join(root, "first.md");
      const second = path.join(root, "second.md");
      await fs.writeFile(root, "original root");
      const rename = fs.rename.bind(fs);
      const spy = vi.spyOn(fs, "rename").mockImplementation(async (from, to) => {
        if (fail && String(from).endsWith(".apply") && to === second) throw new Error("injected second write");
        return rename(from, to);
      });
      try {
        const operation = applySnapshotTransaction({
          deletes: [root],
          writes: [
            { target: first, content: Buffer.from("first") },
            { target: second, content: Buffer.from("second") },
          ],
        });
        if (fail) {
          await assert.rejects(operation, /guarded recovery requires review/);
          assert.equal(await fs.readFile(first, "utf8"), "first");
          await assert.rejects(fs.access(second), { code: "ENOENT" });
          await assert.rejects(recoverPendingSnapshotTransactions(), /newer bytes/);
          const transactions = path.join(agentDir, "pi-sync/transactions");
          const entries = await fs.readdir(transactions);
          assert.equal(
            await fs.readFile(path.join(transactions, entries[0] ?? "", "before/0"), "utf8"),
            "original root",
          );
        } else {
          await operation;
          assert.equal(await fs.readFile(first, "utf8"), "first");
          assert.equal(await fs.readFile(second, "utf8"), "second");
        }
      } finally {
        spy.mockRestore();
      }
    }));
