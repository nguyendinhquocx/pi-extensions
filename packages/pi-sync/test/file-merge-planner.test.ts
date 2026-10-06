import assert from "node:assert/strict";
import { test } from "vitest";
import type { SnapshotFile } from "../src/snapshot/snapshot-types.js";
import { type FileMergeInput, planFileMerge } from "../src/sync/file-merge-planner.js";
import { snapshot } from "./helpers.js";

function file(content: string, filePath = "settings.json"): SnapshotFile {
  const result = snapshot([{ path: filePath, content: Buffer.from(content) }]).files[0];
  assert.ok(result);
  return result;
}

const ancestor = file("ancestor");
const left = file("left");
const right = file("right");
const empty = file("");

for (const [name, baseline, local, remote, kind, source] of [
  ["unchanged", ancestor, ancestor, ancestor, "accepted", "equal"],
  ["both absent", undefined, undefined, undefined, "accepted", "equal"],
  ["local addition", undefined, left, undefined, "accepted", "local"],
  ["remote addition", undefined, undefined, right, "accepted", "remote"],
  ["local edit", ancestor, left, ancestor, "accepted", "local"],
  ["remote edit", ancestor, ancestor, right, "accepted", "remote"],
  ["local deletion", ancestor, undefined, ancestor, "accepted", "local"],
  ["remote deletion", ancestor, ancestor, undefined, "accepted", "remote"],
  ["equal concurrent edits", ancestor, left, left, "accepted", "equal"],
  ["equal concurrent additions", undefined, left, left, "accepted", "equal"],
  ["equal concurrent deletions", ancestor, undefined, undefined, "accepted", "equal"],
  ["divergent edits", ancestor, left, right, "conflict", undefined],
  ["divergent additions", undefined, left, right, "conflict", undefined],
  ["delete versus modify", ancestor, undefined, right, "conflict", undefined],
  ["modify versus delete", ancestor, left, undefined, "conflict", undefined],
  ["empty is an addition", undefined, empty, undefined, "accepted", "local"],
  ["empty versus nonempty addition", undefined, empty, right, "conflict", undefined],
] as const) {
  test(`file planner: ${name}`, () => {
    const input: FileMergeInput = {
      baseline: baseline ? { "settings.json": baseline.sha256 } : {},
      local: local ? [local] : [],
      remote: remote ? [remote] : [],
      selectionCompatible: true,
    };
    const plan = planFileMerge(input);
    assert.equal(plan.kind, "planned");
    if (plan.kind !== "planned") return;
    if (!baseline && !local && !remote) {
      assert.deepEqual(plan.decisions, []);
      return;
    }
    const decision = plan.decisions[0];
    assert.ok(decision);
    assert.equal(decision.kind, kind);
    if (decision.kind === "accepted") {
      assert.equal(decision.source, source);
      const expected = source === "remote" ? remote : local;
      assert.equal(decision.file, expected);
    } else {
      assert.equal(decision.reason, "both-changed");
    }
  });
}

test("file planner preserves independent edits and explicit deletion decisions", () => {
  const a = file("a", "AGENTS.md");
  const b = file("b", "prompts/b.md");
  const c = file("c", "prompts/c.md");
  const editedA = file("edited-a", a.path);
  const editedB = file("edited-b", b.path);
  const plan = planFileMerge({
    baseline: Object.fromEntries([a, b, c].map((item) => [item.path, item.sha256])),
    local: [editedA, b],
    remote: [a, editedB, c],
    selectionCompatible: true,
  });
  assert.equal(plan.kind, "planned");
  if (plan.kind !== "planned") return;
  assert.deepEqual(plan.conflicts, []);
  assert.deepEqual(
    plan.decisions.map((item) => item.kind === "accepted" && item.file),
    [editedA, editedB, undefined],
  );
});

test("file planner retains missing-ancestor and selection review", () => {
  const input = { local: [left], remote: [right], selectionCompatible: true };
  assert.deepEqual(planFileMerge({ ...input, baseline: undefined }), { kind: "review", reason: "missing-baseline" });
  assert.deepEqual(planFileMerge({ ...input, baseline: {}, selectionCompatible: false }), {
    kind: "review",
    reason: "selection-changed",
  });
});

test("file planner withholds remote active-session writes and deletions but permits local upload", () => {
  const sessionPath = "sessions/workspace/current.jsonl";
  const base = file("base", sessionPath);
  const changed = file("changed", sessionPath);
  for (const remote of [[changed], []]) {
    const plan = planFileMerge({
      baseline: { [sessionPath]: base.sha256 },
      local: [base],
      remote,
      selectionCompatible: true,
      protectedPaths: new Set([sessionPath]),
    });
    assert.equal(plan.kind, "planned");
    if (plan.kind === "planned")
      assert.deepEqual(plan.conflicts, [{ kind: "conflict", path: sessionPath, reason: "protected-session" }]);
  }
  const plan = planFileMerge({
    baseline: { [sessionPath]: base.sha256 },
    local: [changed],
    remote: [base],
    selectionCompatible: true,
    protectedPaths: new Set([sessionPath]),
  });
  assert.equal(plan.kind, "planned");
  if (plan.kind === "planned") assert.deepEqual(plan.conflicts, []);
});

for (const paths of [
  ["prompts/Foo.md", "prompts/foo.md"],
  ["prompts/café.md", "prompts/cafe\u0301.md"],
  ["custom", "custom/nested.md"],
  ["Custom", "custom/nested.md"],
]) {
  test(`file planner defers the complete colliding group: ${paths.join(", ")}`, () => {
    const plan = planFileMerge({
      baseline: {},
      local: [file("local", paths[0])],
      remote: [file("remote", paths[1])],
      selectionCompatible: true,
    });
    assert.equal(plan.kind, "planned");
    if (plan.kind === "planned") {
      assert.equal(plan.conflicts.length, 2);
      assert.ok(plan.conflicts.every((item) => item.reason === "path-collision"));
    }
  });
}

test("file planner exhausts hash equality and absence equivalence classes", () => {
  const versions = [undefined, ancestor, left, empty];
  for (const baseline of versions) {
    for (const local of versions) {
      for (const remote of versions) {
        const plan = planFileMerge({
          baseline: baseline ? { "settings.json": baseline.sha256 } : {},
          local: local ? [local] : [],
          remote: remote ? [remote] : [],
          selectionCompatible: true,
        });
        assert.equal(plan.kind, "planned");
        if (plan.kind !== "planned") continue;
        const expectedConflict =
          local?.sha256 !== remote?.sha256 && local?.sha256 !== baseline?.sha256 && remote?.sha256 !== baseline?.sha256;
        assert.equal(plan.conflicts.length, expectedConflict ? 1 : 0);
        const decision = plan.decisions[0];
        if (decision?.kind === "accepted") {
          const expected = local?.sha256 === remote?.sha256 || remote?.sha256 === baseline?.sha256 ? local : remote;
          assert.equal(decision.file, expected);
        }
      }
    }
  }
});

test("file planner retains conflict evidence alongside independently accepted paths", () => {
  const unrelated = file("independent", "AGENTS.md");
  const plan = planFileMerge({ baseline: {}, local: [left, unrelated], remote: [right], selectionCompatible: true });
  assert.equal(plan.kind, "planned");
  if (plan.kind !== "planned") return;
  assert.deepEqual(plan.conflicts, [{ kind: "conflict", path: "settings.json", reason: "both-changed" }]);
  assert.deepEqual(plan.decisions[0], { kind: "accepted", path: unrelated.path, source: "local", file: unrelated });
});

test("file planner is deterministic and does not mutate its input", () => {
  const local = [file("a", "prompts/z.md"), file("b", "AGENTS.md")];
  const input = { baseline: {}, local, remote: [], selectionCompatible: true };
  const before = JSON.stringify(input);
  const first = planFileMerge(input);
  assert.deepEqual(planFileMerge({ ...input, local: [...local].reverse() }), first);
  assert.equal(JSON.stringify(input), before);
});

for (const unsafe of [
  "lone-high-\ud800.md",
  "lone-low-\udc00.md",
  "../escape",
  "/absolute",
  "prompts/../settings.json",
  "prompts\\file",
  "sessions/not-jsonl.txt",
  "pi-sync.json",
  "prompts/\u0000file",
  "state/pi-sync/private",
]) {
  test(`file planner rejects unsafe or denied input: ${JSON.stringify(unsafe)}`, () => {
    assert.throws(
      () => planFileMerge({ baseline: {}, local: [file("content", unsafe)], remote: [], selectionCompatible: true }),
      /Unsafe merge path/,
    );
  });
}

for (const nativePath of [
  "notes:2026.md",
  "C:/notes.md",
  "prompts/CON.md",
  "prompts/file. ",
  "prompts/LPT1",
  "prompts/zero\u200bwidth.md",
  "prompts/bidi\u202e.md",
  "prompts/control\u001b.md",
  "prompts/control\u0085.md",
])
  test(`file planner preserves native path compatibility: ${JSON.stringify(nativePath)}`, () => {
    const input = { baseline: {}, local: [file("content", nativePath)], remote: [], selectionCompatible: true };
    // biome-ignore lint/suspicious/noControlCharactersInRegex: Native Windows filename restrictions.
    if (process.platform === "win32" && /:|CON|LPT1|[ .]$|[\u0001-\u001f]/u.test(nativePath)) {
      assert.throws(() => planFileMerge(input), /Unsafe merge path/);
    } else {
      const plan = planFileMerge(input);
      assert.equal(plan.kind, "planned");
      if (plan.kind === "planned") assert.equal(plan.conflicts.length, 0);
    }
  });

test("file planner rejects duplicate paths, damaged hashes and noncanonical base64", () => {
  const input = { baseline: {}, remote: [], selectionCompatible: true };
  assert.throws(() => planFileMerge({ ...input, local: [left, left] }), /Duplicate merge path/);
  assert.throws(() => planFileMerge({ ...input, local: [{ ...left, sha256: ancestor.sha256 }] }), /checksum/);
  assert.throws(() => planFileMerge({ ...input, local: [{ ...left, contentBase64: "@@@@" }] }), /content/);
  assert.throws(() => planFileMerge({ ...input, local: [], baseline: { "AGENTS.md": "bad" } }), /baseline hash/);
});

for (const protectedPath of ["sessions/café/active.jsonl", "sessions/CAFÉ/ACTIVE.JSONL"])
  test(`protected session identity covers filesystem spelling aliases ${protectedPath}`, () => {
    const actual = "sessions/cafe\u0301/active.jsonl";
    const base = file("baseline", actual);
    const changed = file("remote", actual);
    const plan = planFileMerge({
      baseline: { [actual]: base.sha256 },
      local: [base],
      remote: [changed],
      selectionCompatible: true,
      protectedPaths: new Set([protectedPath]),
    });
    assert.equal(plan.kind, "planned");
    if (plan.kind === "planned")
      assert.deepEqual(plan.conflicts, [{ kind: "conflict", path: actual, reason: "protected-session" }]);
  });

test("Node UTF-8 replacement still protects a context's session path", () => {
  const actual = "sessions/\ufffd.jsonl";
  const base = file("baseline", actual);
  const plan = planFileMerge({
    baseline: { [actual]: base.sha256 },
    local: [base],
    remote: [file("remote", actual)],
    selectionCompatible: true,
    protectedPaths: new Set(["sessions/\ud800.jsonl"]),
  });
  assert.equal(plan.kind, "planned");
  if (plan.kind === "planned")
    assert.deepEqual(plan.conflicts, [{ kind: "conflict", path: actual, reason: "protected-session" }]);
});
