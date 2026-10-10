import { describe, expect, it, vi } from "vitest";
import { Collector } from "../src/collector.js";
import type { Call, EntrySummary } from "../src/model.js";
import { ancestors, flatten, hierarchy, reveal, withAncestors } from "../src/web/hierarchy.js";
import { axis, interval, position } from "../src/web/timing.js";

describe("actual-parent explorer", () => {
  it("retains siblings, deep parent edges, and descendant state through collapse", () => {
    const nodes = [
      { id: "a", parentId: null },
      { id: "b", parentId: "a" },
      { id: "c", parentId: "b" },
      { id: "d", parentId: "c" },
      { id: "sibling", parentId: "a" },
    ];
    const tree = hierarchy(nodes);
    const open = reveal(tree, new Set(["d"]), "d");
    expect(flatten(tree, open).map((row) => [row.node.id, row.depth])).toEqual([
      ["a", 0],
      ["b", 1],
      ["c", 2],
      ["d", 3],
      ["sibling", 1],
    ]);
    const collapsed = new Set(open);
    collapsed.delete("a");
    expect(flatten(tree, collapsed).map((row) => row.node.id)).toEqual(["a"]);
    collapsed.add("a");
    expect(flatten(tree, collapsed)).toEqual(flatten(tree, open));
    expect(nodes[3]?.parentId).toBe("c");
  });
  it("supports long chains iteratively without a hierarchy depth cap", () => {
    const nodes = Array.from({ length: 1600 }, (_, i) => ({ id: String(i), parentId: i ? String(i - 1) : null }));
    const tree = hierarchy(nodes);
    const open = new Set(tree.nodes.keys());
    expect(flatten(tree, open).at(-1)?.depth).toBe(1599);
    expect(ancestors(tree, "1599")).toHaveLength(1599);
  });
  it("keeps real ancestor context for filters, diagnoses orphans/cycles without rewriting parents", () => {
    const nodes = [
      { id: "a", parentId: null },
      { id: "b", parentId: "a" },
      { id: "c", parentId: "b" },
      { id: "orphan", parentId: "absent" },
      { id: "x", parentId: "y" },
      { id: "y", parentId: "x" },
    ];
    const tree = hierarchy(nodes);
    expect([...withAncestors(tree, new Set(["c"]))].sort()).toEqual(["a", "b", "c"]);
    expect(flatten(tree, new Set(tree.nodes.keys()))).toHaveLength(nodes.length);
    expect(tree.nodes.get("orphan")?.parentId).toBe("absent");
    expect(tree.nodes.get("x")?.parentId).toBe("y");
  });
});
describe("recorded observation timing", () => {
  it("records actual start/end callbacks while preserving reported monotonic duration", () => {
    const collector = new Collector();
    vi.spyOn(Date, "now").mockReturnValueOnce(1000).mockReturnValueOnce(1250);
    try {
      collector.start({ type: "tool_execution_start", toolCallId: "c", toolName: "read", args: {} }, null);
      collector.end(
        { type: "tool_execution_end", toolCallId: "c", toolName: "read", isError: false, result: {}, durationMs: 10 },
        null,
      );
      const call = collector.list()[0];
      expect(call).toMatchObject({ observedStartedAt: 1000, observedEndedAt: 1250, durationMs: 10 });
      if (!call) throw new Error("Missing call");
      expect(interval(call)).toEqual({ start: 1000, end: 1250 });
    } finally {
      vi.restoreAllMocks();
    }
  });
  it("never synthesizes starts for update/end-only events or running spans", () => {
    const collector = new Collector();
    collector.update(
      { type: "tool_execution_update", toolCallId: "u", toolName: "read", args: {}, partialResult: {} },
      null,
    );
    collector.end(
      { type: "tool_execution_end", toolCallId: "e", toolName: "read", isError: true, result: {}, durationMs: 42 },
      null,
    );
    for (const call of collector.list()) {
      expect(call.observedStartedAt).toBeUndefined();
      expect(interval(call)).toBeUndefined();
    }
    collector.start({ type: "tool_execution_start", toolCallId: "r", toolName: "read", args: {} }, null);
    const running = collector.list().find((call) => call.id === "r");
    if (!running) throw new Error("Missing running");
    expect(interval(running)).toBeUndefined();
  });
  it("uses a shared absolute axis; invalid/reversed clocks do not produce spans", () => {
    const entry = { timestamp: "1970-01-01T00:00:01.000Z" } as EntrySummary;
    const call = { observedStartedAt: 1500, observedEndedAt: 2000 } as Call;
    const range = axis([entry], [call]);
    expect(range).toEqual({ start: 1000, end: 2000 });
    if (!range) throw new Error("Missing axis");
    expect(position(1500, range)).toBe(50);
    expect(interval({ ...call, observedEndedAt: 1000 })).toBeUndefined();
    expect(axis([{ ...entry, timestamp: "unknown" }], [])).toBeUndefined();
    expect(position(1000, { start: 1000, end: 1000 })).toBe(50);
  });
});
