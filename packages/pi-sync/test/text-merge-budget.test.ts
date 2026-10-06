import assert from "node:assert/strict";
import { test } from "vitest";
import { stageMergeBaseline } from "../src/state/merge-baseline-store.js";
import { resolveContentConflicts } from "../src/sync/content-conflicts.js";
import { planFileMerge } from "../src/sync/file-merge-planner.js";
import { fileHashMap } from "../src/sync/sync-state.js";
import { mergeText, TEXT_MERGE_WORK_LIMIT } from "../src/sync/text-merge.js";
import { snapshot, withTempHome } from "./helpers.js";
import { fixture } from "./partial-sync-fixture.js";

const base = Buffer.from("a\nb\nc\n");
const local = Buffer.from("A\nb\nc\n");
const remote = Buffer.from("a\nb\nC\n");

test("one budget bounds both LCS grids and hunk comparisons across files", () => {
  const budget = { remaining: 66 };
  for (let i = 0; i < 2; i++) assert.equal(mergeText(base, local, remote, { budget })?.toString(), "A\nb\nC\n");
  assert.equal(budget.remaining, 0);
  for (let i = 0; i < 1000; i++) assert.equal(mergeText(base, local, remote, { budget }), undefined);
  assert.equal(budget.remaining, 0);
});

test("hunk work cannot bypass a grid-only budget", () => {
  const budget = { remaining: 32 };
  assert.equal(mergeText(base, local, remote, { budget }), undefined);
  assert.equal(budget.remaining, 0);
});

test("unsupported encodings and per-grid bounds do not allocate operation work", () => {
  const budget = { remaining: TEXT_MERGE_WORK_LIMIT };
  assert.equal(mergeText(base, Buffer.from([255]), remote, { budget }), undefined);
  assert.equal(
    mergeText(Buffer.from("a\n".repeat(2500)), Buffer.from("b\n".repeat(2500)), remote, { budget }),
    undefined,
  );
  assert.equal(budget.remaining, TEXT_MERGE_WORK_LIMIT);
});

test("text cancellation is propagated rather than converted into a conflict", () => {
  const controller = new AbortController();
  controller.abort(new Error("cancelled text operation"));
  const budget = { remaining: 66 };
  assert.throws(
    () => mergeText(base, local, remote, { budget, signal: controller.signal }),
    /cancelled text operation/,
  );
  assert.equal(budget.remaining, 66);
});

test("cancellation after reservation is checked at the DP row boundary", () => {
  const controller = new AbortController();
  let remaining = 66;
  const budget = {
    get remaining() {
      return remaining;
    },
    set remaining(value) {
      remaining = value;
      controller.abort(new Error("cancelled DP"));
    },
  };
  assert.throws(() => mergeText(base, local, remote, { budget, signal: controller.signal }), /cancelled DP/);
  assert.equal(remaining, 34);
});

test("conflict resolution shares its budget across files and subsequent attempts", async () =>
  withTempHome(async (root) => {
    const f = await fixture(root);
    const paths = Array.from({ length: 32 }, (_, index) => `prompts/${index}.md`);
    const image = (content: Buffer) => snapshot(paths.map((path) => ({ path, content })));
    const before = image(base);
    const ours = image(local);
    const theirs = image(remote);
    const state = { ...f.state, lastFileHashes: fileHashMap(before) };
    await stageMergeBaseline(f.config, before, state);
    const plan = planFileMerge({
      baseline: state.lastFileHashes,
      local: ours.files,
      remote: theirs.files,
      selectionCompatible: true,
    });
    const textBudget = { remaining: 66 };
    const resolved = await resolveContentConflicts(f.config, state, ours, theirs, plan, new Set(), { textBudget });
    assert.equal(resolved.kind, "planned");
    if (resolved.kind !== "planned") return;
    assert.equal(resolved.conflicts.length, 30);
    assert.equal(textBudget.remaining, 0);
    const retry = await resolveContentConflicts(f.config, state, ours, theirs, plan, new Set(), { textBudget });
    assert.deepEqual(retry, plan);
    const controller = new AbortController();
    controller.abort(new Error("cancelled resolution"));
    await assert.rejects(
      resolveContentConflicts(f.config, state, ours, theirs, plan, new Set(), {
        textBudget,
        signal: controller.signal,
      }),
      /cancelled resolution/,
    );
  }));
