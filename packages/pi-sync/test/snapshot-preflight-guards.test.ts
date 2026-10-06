import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { test, vi } from "vitest";
import { createMockContext } from "../../../test/support.js";
import { applySnapshot, preflightSnapshotMutations } from "../src/snapshot/snapshot-apply.js";
import { applyMergedSnapshot } from "../src/sync/merge-apply.js";
import { captureMutationOwner } from "../src/sync/sync-local.js";
import { snapshot, withTempHome } from "./helpers.js";

type Boundary = "lstat" | "mkdir" | "fsync";
function invalidateAt(root: string, boundary: Boundary, invalidate: () => void) {
  const prefix = path.join(root, "prompts");
  let fired = false;
  const fire = () => {
    if (!fired) {
      fired = true;
      invalidate();
    }
  };
  const restores: (() => void)[] = [];
  if (boundary === "lstat") {
    const original = fs.lstat.bind(fs);
    const spy = vi.spyOn(fs, "lstat").mockImplementation(async (...args) => {
      try {
        return await original(...args);
      } finally {
        if (args[0] === prefix) fire();
      }
    });
    restores.push(() => spy.mockRestore());
  } else if (boundary === "mkdir") {
    const original = fs.mkdir.bind(fs);
    const spy = vi.spyOn(fs, "mkdir").mockImplementation(async (...args) => {
      const result = await original(...args);
      if (args[0] === prefix) fire();
      return result;
    });
    restores.push(() => spy.mockRestore());
  } else {
    const original = fs.open.bind(fs);
    const spy = vi.spyOn(fs, "open").mockImplementation(async (...args) => {
      const handle = await original(...args);
      if (args[0] === root && args[1] === "r") {
        const sync = handle.sync.bind(handle);
        const syncSpy = vi.spyOn(handle, "sync").mockImplementation(async () => {
          await sync();
          fire();
        });
        restores.push(() => syncSpy.mockRestore());
      }
      return handle;
    });
    restores.push(() => spy.mockRestore());
  }
  return {
    fired: () => fired,
    restore: () => {
      for (const restore of restores.reverse()) restore();
    },
  };
}

function planFor(root: string) {
  return {
    deletes: [],
    writes: ["prompts/first/deep/a.md", "prompts/second/b.md"].map((relative) => ({
      target: path.join(root, relative),
      content: Buffer.from("remote bytes"),
    })),
  };
}

for (const guard of ["abort", "owner"] as const)
  for (const boundary of ["lstat", "mkdir", "fsync"] as const)
    test.skipIf(boundary === "fsync" && process.platform === "win32")(
      `mutating preflight stops ${guard} after ${boundary}`,
      async () =>
        withTempHome(async (root) => {
          await fs.mkdir(root, { recursive: true });
          const controller = new AbortController();
          let current = true;
          const hook = invalidateAt(root, boundary, () => {
            current = false;
            if (guard === "abort") controller.abort();
          });
          const validateMutation = () => {
            if (guard === "owner" && !current) throw new Error("test owner replaced");
          };
          try {
            await assert.rejects(
              preflightSnapshotMutations(root, planFor(root), undefined, {
                signal: controller.signal,
                validateMutation,
              }),
              guard === "abort" ? /abort/i : /owner replaced/,
            );
            assert.equal(hook.fired(), true);
            if (boundary === "lstat") await assert.rejects(fs.access(path.join(root, "prompts")), { code: "ENOENT" });
            else await fs.access(path.join(root, "prompts"));
            await assert.rejects(fs.access(path.join(root, "prompts/first")), { code: "ENOENT" });
            await assert.rejects(fs.access(path.join(root, "prompts/second")), { code: "ENOENT" });
          } finally {
            hook.restore();
          }
        }),
    );

test("pre-aborted preflight performs no filesystem lookup or directory creation", async () =>
  withTempHome(async (root) => {
    await fs.mkdir(root, { recursive: true });
    const controller = new AbortController();
    controller.abort();
    const lstat = vi.spyOn(fs, "lstat");
    const mkdir = vi.spyOn(fs, "mkdir");
    try {
      await assert.rejects(
        preflightSnapshotMutations(root, planFor(root), undefined, { signal: controller.signal }),
        /abort/i,
      );
      assert.equal(lstat.mock.calls.length, 0);
      assert.equal(mkdir.mock.calls.length, 0);
    } finally {
      lstat.mockRestore();
      mkdir.mockRestore();
    }
  }));

test("an ENOENT-shaped abort reason is never treated as a missing directory", async () =>
  withTempHome(async (root) => {
    await fs.mkdir(root, { recursive: true });
    const controller = new AbortController();
    const reason = Object.assign(new Error("cancelled marker"), { code: "ENOENT" });
    const hook = invalidateAt(root, "lstat", () => controller.abort(reason));
    try {
      await assert.rejects(
        preflightSnapshotMutations(root, planFor(root), undefined, { signal: controller.signal }),
        reason,
      );
      await assert.rejects(fs.access(path.join(root, "prompts")), { code: "ENOENT" });
    } finally {
      hook.restore();
    }
  }));

test("delete-parent lookup revalidates ownership before any later write preflight", async () =>
  withTempHome(async (root) => {
    await fs.mkdir(path.join(root, "prompts"), { recursive: true });
    let current = true;
    const hook = invalidateAt(root, "lstat", () => {
      current = false;
    });
    try {
      await assert.rejects(
        preflightSnapshotMutations(
          root,
          {
            ...planFor(root),
            deletes: [path.join(root, "prompts/gone/file.md")],
          },
          undefined,
          {
            validateMutation: () => {
              if (!current) throw new Error("owner replaced");
            },
          },
        ),
        /owner replaced/,
      );
      await assert.rejects(fs.access(path.join(root, "prompts/first")), { code: "ENOENT" });
    } finally {
      hook.restore();
    }
  }));

test("guarded preflight still defers descendants of a file ancestor scheduled for deletion", async () =>
  withTempHome(async (root) => {
    await fs.mkdir(root, { recursive: true });
    const ancestor = path.join(root, "prompts");
    await fs.writeFile(ancestor, "before file");
    const validate = vi.fn();
    await preflightSnapshotMutations(root, { ...planFor(root), deletes: [ancestor] }, undefined, {
      validateMutation: validate,
    });
    assert.ok(validate.mock.calls.length > 0);
    assert.equal(await fs.readFile(ancestor, "utf8"), "before file");
    await assert.rejects(fs.access(path.join(ancestor, "first")), { code: "ENOTDIR" });
  }));

for (const caller of ["merged", "directional"] as const)
  for (const guard of ["abort", "replacement"] as const)
    test(`${caller} apply forwards ${guard} guards into directory creation`, async () =>
      withTempHome(async (root) => {
        await fs.mkdir(root, { recursive: true });
        const ctx = createMockContext().ctx as ExtensionContext;
        const controller = new AbortController();
        const validateMutation = captureMutationOwner(ctx, controller.signal);
        const hook = invalidateAt(root, "mkdir", () => {
          if (guard === "abort") controller.abort();
          else Object.assign(ctx, { sessionManager: (createMockContext().ctx as ExtensionContext).sessionManager });
        });
        const after = snapshot([
          { path: "prompts/first/deep/a.md", content: Buffer.from("remote bytes") },
          { path: "prompts/second/b.md", content: Buffer.from("remote bytes") },
        ]);
        const options = { include: ["prompts"], signal: controller.signal, validateMutation };
        try {
          const applied =
            caller === "merged"
              ? applyMergedSnapshot(snapshot([]), after, new Set(), options, async () => validateMutation())
              : applySnapshot(after, new Set(), options);
          await assert.rejects(applied, guard === "abort" ? /abort/i : /Session changed/);
          assert.equal(hook.fired(), true);
          await fs.access(path.join(root, "prompts"));
          await assert.rejects(fs.access(path.join(root, "prompts/first")), { code: "ENOENT" });
          await assert.rejects(fs.access(path.join(root, "prompts/second")), { code: "ENOENT" });
        } finally {
          hook.restore();
        }
      }));
