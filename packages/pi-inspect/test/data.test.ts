import { type SessionEntry, SessionManager } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import { Collector } from "../src/collector.js";
import { capture, displayText } from "../src/privacy.js";
import { branch, detail, snapshot, summarize } from "../src/projection.js";
import { fixture, skills, tools } from "./fixtures.js";

describe("read-only projection", () => {
  it("preserves branches, labels, compaction, system replay and raw edits", () => {
    const f = fixture();
    const before = JSON.stringify(f.manager.getEntries());
    const leaf = f.manager.getLeafId();
    const view = snapshot(f.manager, new Collector(), "g", 0, "runtime prompt", tools, ["read", "hidden"], skills);
    expect(view.nodes.find((n) => n.id === f.alternate)?.label).toBe("Alternative");
    expect(view.nodes.some((n) => n.kind === "custom")).toBe(true);
    const historical = branch(f.manager, f.delta, 0, skills);
    expect(historical.prompt.value).toContain("changed");
    expect(historical.previousPrompt.value).toContain("original");
    expect(historical.declaredTools.value).toEqual([]);
    const alternate = branch(f.manager, f.alternate, 0, skills);
    expect(alternate.entries.map((e) => e.id)).not.toContain(f.assistant);
    const compacted = branch(f.manager, f.leaf, 0, skills);
    expect(JSON.stringify(compacted.projection.value)).toContain("summary");
    const raw = detail(f.manager, f.user, f.delta, new Collector());
    expect(JSON.stringify(raw.raw)).toContain("first request");
    expect(JSON.stringify(branch(f.manager, f.compact, 0, skills))).toContain("changed");
    expect(f.manager.getLeafId()).toBe(leaf);
    expect(JSON.stringify(f.manager.getEntries())).toBe(before);
    expect(view.tools.map((t) => [t.active, t.callable])).toEqual([
      [true, true],
      [false, true],
      [true, false],
    ]);
    expect(historical.skillEvidence.value).toEqual([
      { name: "example", state: "successfully read (nested metadata)", entryId: f.result },
    ]);
  });
  it("applies context edits without rewriting history and paginates", () => {
    const f = fixture();
    const edit = f.manager.getEntries().find((e) => e.type === "context_edit");
    expect(edit).toBeDefined();
    if (!edit) return;
    const changed = detail(f.manager, f.user, edit.id, new Collector());
    expect(JSON.stringify(changed.projected)).toContain("edited for context only");
    expect(JSON.stringify(changed.raw)).toContain("first request");
    expect(branch(f.manager, f.delta, 2, skills).entries[0]?.id).toBe(f.assistant);
    expect(() => branch(f.manager, "missing", 0, skills)).toThrow();
  });
  it("preserves branch summaries, explicit skills, failed reads, and unknown entry previews", () => {
    const f = fixture();
    const summary = f.manager.branchWithSummary(f.user, "abandoned branch summary");
    expect(JSON.stringify(branch(f.manager, summary, 0, skills).projection)).toContain("abandoned branch summary");
    const invoked = f.manager.appendMessage({
      role: "user",
      content: '<skill name="example" location="/skills/example/SKILL.md">\nInstructions\n</skill>',
      timestamp: 7,
    });
    expect(JSON.stringify(branch(f.manager, invoked, 0, skills).skillEvidence)).toContain("explicitly invoked");
    const failed = f.manager.appendMessage({
      role: "toolResult",
      toolName: "read",
      toolCallId: "failed",
      isError: true,
      content: [{ type: "text", text: "failure" }],
      timestamp: 8,
    });
    expect(JSON.stringify(branch(f.manager, failed, 0, skills).skillEvidence)).not.toContain("successfully read");
    const unknown = { type: "future_entry", id: "future", parentId: null, timestamp: "", unexpected: true };
    expect(summarize(unknown as unknown as Parameters<typeof summarize>[0]).kind).toBe("future_entry");
    const header = f.manager.getHeader();
    if (!header) throw new Error("Fixture has no session header");
    const future = SessionManager.inMemory("/fixture", undefined, [header, unknown as unknown as SessionEntry]);
    expect(snapshot(future, new Collector(), "g", 0, "", [], [], []).nodes[0]?.kind).toBe("future_entry");
  });
  it("derives display metadata only from recorded messages and tolerates legacy missing usage", () => {
    const f = fixture();
    const entry = f.manager.getEntry(f.assistant);
    if (entry?.type !== "message" || entry.message.role !== "assistant") throw new Error("Missing assistant fixture");
    const copy = JSON.parse(JSON.stringify(entry)) as typeof entry;
    if (copy.message.role !== "assistant") throw new Error("Invalid clone");
    copy.message.usage.totalTokens = 1234;
    expect(summarize(copy)).toMatchObject({ name: "faux-1", tokens: 1234 });
    const legacy = JSON.parse(JSON.stringify(copy));
    delete legacy.message.usage;
    delete legacy.message.model;
    expect(summarize(legacy).tokens).toBeUndefined();
    expect(summarize(legacy).name).toBeUndefined();
    copy.message.stopReason = "error";
    expect(summarize(copy).status).toBe("error");
    copy.message.stopReason = "aborted";
    expect(summarize(copy).status).toBe("cancelled");
    const result = f.manager.getEntry(f.result);
    if (!result) throw new Error("Missing result fixture");
    expect(summarize(result)).toMatchObject({ status: "success", name: "codemode", toolCallId: "parent" });
    const legacyResult = JSON.parse(JSON.stringify(result));
    delete legacyResult.message.isError;
    expect(summarize(legacyResult).status).toBeUndefined();
  });
  it("replays serialized resumed history without rewriting raw entries", () => {
    const f = fixture();
    const header = f.manager.getHeader();
    if (!header) throw new Error("Fixture has no session header");
    const records = JSON.parse(JSON.stringify([header, ...f.manager.getEntries()]));
    const resumed = SessionManager.inMemory("/fixture", undefined, records);
    expect(branch(resumed, f.compact, 0, skills)).toEqual(branch(f.manager, f.compact, 0, skills));
    expect(JSON.stringify(resumed.getEntries())).toBe(JSON.stringify(f.manager.getEntries()));
  });
  it("caps tree inventory and discloses overflow", () => {
    const manager = SessionManager.inMemory("/fixture");
    for (let i = 0; i < 10001; i++) manager.appendMessage({ role: "user", content: `row ${i}`, timestamp: i });
    const view = snapshot(manager, new Collector(), "g", 0, "", [], [], []);
    expect(view.totalEntries).toBe(10001);
    expect(view.nodes).toHaveLength(10000);
    expect(view.incomplete).toBe(true);
  });
  it("keeps unknown legacy prompt states and multiple roots explicit", () => {
    const f = fixture();
    f.manager.resetLeaf();
    const root = f.manager.appendMessage({ role: "user", content: "legacy", timestamp: 1 });
    const view = branch(f.manager, root, 0, []);
    expect(view.prompt.value).toBe("[unavailable: no stored system prompt]");
    expect(view.entries).toHaveLength(1);
    expect(view.entries[0]?.parentId).toBe(null);
  });
});

describe("bounded generic collector", () => {
  it("correlates concurrent, multi-depth children and missing start/end events", () => {
    const c = new Collector();
    for (const [id, parent] of [
      ["a", undefined],
      ["a/1", "a"],
      ["a/2", "a"],
      ["a/1/1", "a/1"],
    ] as const) {
      c.start(
        { type: "tool_execution_start", toolCallId: id, toolName: "test", args: { x: id }, parentToolCallId: parent },
        "leaf",
      );
    }
    c.end(
      {
        type: "tool_execution_end",
        toolCallId: "a/2",
        toolName: "test",
        parentToolCallId: "a",
        isError: true,
        result: { content: "blocked" },
      },
      "leaf",
    );
    c.end(
      {
        type: "tool_execution_end",
        toolCallId: "missing-start",
        toolName: "read",
        isError: false,
        durationMs: 4,
        result: { content: "ok" },
      },
      "leaf",
    );
    c.settle();
    expect(c.list().find((v) => v.id === "a/2")?.status).toBe("error");
    expect(c.list().find((v) => v.id === "a/1")?.status).toBe("unfinished");
    expect(c.list().find((v) => v.id === "missing-start")?.args.value).toBe("[not captured]");
    const f = fixture();
    c.start(
      {
        type: "tool_execution_start",
        toolCallId: "parent/1/2",
        parentToolCallId: "parent/1",
        toolName: "nested",
        args: {},
      },
      f.assistant,
    );
    c.start(
      { type: "tool_execution_start", toolCallId: "parent/1", parentToolCallId: "parent", toolName: "read", args: {} },
      f.assistant,
    );
    expect(detail(f.manager, f.assistant, f.result, c).calls).toHaveLength(2);
  });
  it("bounds updates, evicts records and exposes gaps", () => {
    const c = new Collector(2);
    for (const id of ["a", "b", "c"])
      c.update(
        {
          type: "tool_execution_update",
          toolCallId: id,
          toolName: "test",
          args: {},
          partialResult: "x".repeat(1000000),
        },
        null,
      );
    expect(c.list()).toHaveLength(2);
    expect(c.dropped).toBe(1);
    expect(c.list()[0]?.result?.truncated).toBe(true);
    expect(JSON.stringify(c.list()).length).toBeLessThan(70000);
  });
});

describe("display privacy", () => {
  it("bounds huge/cyclic values and redacts structured secrets without mutation", () => {
    const input = { api_key: "secret", headers: { Authorization: "secret" }, text: "Bearer abc123", data: "opaque" };
    expect(JSON.stringify(capture(input))).not.toContain("secret");
    expect(input.api_key).toBe("secret");
    const getter = {
      get dangerous() {
        throw new Error("Must not evaluate display getters");
      },
    };
    expect(capture(getter)).toEqual({ value: { dangerous: "[accessor omitted]" }, truncated: true });
    const cycle: { self?: unknown } = {};
    cycle.self = cycle;
    expect(capture(cycle).value).toEqual({ self: "[circular]" });
    const shared = { value: "same" };
    expect(capture([shared, shared]).value).toEqual([shared, shared]);
    expect(capture(Array(100000).fill("x"), 100).truncated).toBe(true);
    expect(displayText("\x1b[31mred\x1b[0m\x1b]0;bad\x07")).toBe("red");
  });
  it("allows only bounded raster data and omits SVG/oversized images", () => {
    const image = { type: "image", mimeType: "image/png", data: "YWJj" };
    expect(capture(image).value).toEqual(image);
    expect(JSON.stringify(capture({ ...image, mimeType: "image/svg+xml" }))).toContain("omitted");
    expect(JSON.stringify(capture({ ...image, data: "a".repeat(1000000) }))).not.toContain("a".repeat(100));
  });
});
