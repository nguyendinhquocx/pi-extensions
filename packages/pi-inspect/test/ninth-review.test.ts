import { getCurrentSystemMessage, getCurrentSystemPrompt, getCurrentTools } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { buildSessionProjection } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import { Collector } from "../src/collector.js";
import { SessionFeed } from "../src/feed.js";
import { capture } from "../src/privacy.js";
import { branch, detail, snapshot } from "../src/projection.js";
import { SYSTEM_REPLAY_TOOL_DELTAS as LIMIT, systemMessageIssue, systemReplayIssue } from "../src/system-message.js";
import { fixture } from "./fixtures.js";

vi.mock("@earendil-works/pi-ai", async (importOriginal) => {
  const original = await importOriginal<typeof import("@earendil-works/pi-ai")>();
  return {
    ...original,
    getCurrentSystemMessage: vi.fn(original.getCurrentSystemMessage),
    getCurrentSystemPrompt: vi.fn(original.getCurrentSystemPrompt),
    getCurrentTools: vi.fn(original.getCurrentTools),
  };
});
const tools = (count: number) =>
  Array.from({ length: count }, (_, i) => ({ name: `t${i}`, description: "", parameters: {} }));
function clearReplay() {
  vi.mocked(getCurrentSystemMessage).mockClear();
  vi.mocked(getCurrentSystemPrompt).mockClear();
  vi.mocked(getCurrentTools).mockClear();
}
function noReplay() {
  expect(getCurrentSystemMessage).not.toHaveBeenCalled();
  expect(getCurrentSystemPrompt).not.toHaveBeenCalled();
  expect(getCurrentTools).not.toHaveBeenCalled();
}
describe("R47: tool delta and metadata replay budgets", () => {
  it("preserves exact boundary and rejects one more delta before validation scans", () => {
    expect(systemReplayIssue([{ role: "system", content: "", toolsAdded: tools(LIMIT) }])).toBeUndefined();
    expect(systemMessageIssue({ role: "system", content: "", toolsAdded: tools(LIMIT + 1) })).toContain("budget");
    const oversized = new Array(LIMIT + 1);
    Object.defineProperty(oversized, "0", {
      get() {
        throw Error("Must not scan");
      },
    });
    expect(systemMessageIssue({ role: "system", content: "", toolsRemoved: oversized })).toContain("budget");
  });
  it.each(["toolsAdded", "toolsRemoved"])("counts %s cumulatively, including repeated names", (kind) => {
    const messages = [
      { role: "system", content: "", [kind]: tools(1025) },
      { role: "system", content: "", [kind]: tools(1025) },
    ];
    expect(systemReplayIssue(messages)).toContain("cumulative");
  });
  it.each(["description", "parameters", "nodes", "depth"])("bounds declaration %s without serialization", (field) => {
    const tool = { name: "t", description: "", parameters: {} } as Record<string, unknown>;
    if (field === "description") tool.description = "x".repeat(1_048_576);
    if (field === "parameters") tool.parameters = { value: "x".repeat(1_048_576) };
    if (field === "nodes") tool.parameters = Array.from({ length: 16385 }, () => ({}));
    if (field === "depth") {
      let value: unknown = {};
      for (let i = 0; i < 34; i++) value = { value };
      tool.parameters = value;
    }
    expect(systemReplayIssue([{ role: "system", content: "", toolsAdded: [tool] }])).toContain("metadata");
  });
  it.each([false, true])("guards ordinary/checkpoint sources and retains raw evidence %s", (checkpoint) => {
    const f = fixture();
    const e = f.manager.getEntry(checkpoint ? f.compact : f.system);
    if (!e) throw Error("Missing");
    const message = checkpoint
      ? (e as unknown as { systemMessage: Record<string, unknown> }).systemMessage
      : (e as unknown as { message: Record<string, unknown> }).message;
    Object.assign(message, { toolsAdded: tools(LIMIT + 1) });
    clearReplay();
    expect(branch(f.manager, checkpoint ? f.leaf : f.user, 0, []).ancestryIssue).toContain("budget");
    noReplay();
    expect(detail(f.manager, e.id, e.id, new Collector()).raw).toBeDefined();
    noReplay();
  });
  it("guards cumulative current and previous projections while preserving valid native ordering", () => {
    const f = fixture();
    const e = f.manager.getEntry(f.system);
    if (e?.type !== "message") throw Error("Missing");
    Object.assign(e.message, { toolsAdded: tools(1025) });
    f.manager.branch(f.user);
    const next = f.manager.appendMessage({ role: "system", content: "", toolsRemoved: tools(1025), timestamp: 2 });
    clearReplay();
    expect(branch(f.manager, next, 0, []).ancestryIssue).toContain("budget");
    noReplay();
    const valid = branch(f.manager, f.user, 0, []);
    expect(valid.ancestryIssue).toBeUndefined();
    expect(valid.declaredTools.value).toEqual(
      capture(getCurrentTools(buildSessionProjection(f.manager.getEntries(), f.user).messages)).value,
    );
  });
});
it("checks previous tool replay independently of a compacted current context", () => {
  const f = fixture();
  const e = f.manager.getEntry(f.system);
  if (e?.type !== "message") throw Error("Missing");
  Object.assign(e.message, { toolsAdded: tools(LIMIT) });
  clearReplay();
  expect(branch(f.manager, f.compact, 0, []).ancestryIssue).toContain("budget");
  noReplay();
  expect(branch(f.manager, f.leaf, 0, []).ancestryIssue).toBeUndefined();
});
function event(id: unknown, parent: unknown = undefined, name: unknown = "read") {
  return {
    type: "tool_execution_start" as const,
    toolCallId: id as string,
    parentToolCallId: parent as string | undefined,
    toolName: name as string,
    args: {},
    result: "done",
    partialResult: "part",
    isError: false,
  };
}
describe("R48: every live admission and publication identity", () => {
  it("publishes rejected events through an already-cached session feed", () => {
    const f = fixture();
    const c = new Collector();
    const feed = new SessionFeed({
      pi: { getAllTools: () => [], getActiveTools: () => [] } as unknown as ExtensionAPI,
      context: () => ({ sessionManager: f.manager, getSystemPrompt: () => "" }) as unknown as ExtensionContext,
      collector: c,
      skills: [],
      generation: "g",
      signal: new AbortController().signal,
      invalidate: () => {},
    });
    try {
      expect(feed.snapshot().invalidCallEvents).toBe(0);
      expect(c.update({ ...event("x".repeat(513)), type: "tool_execution_update" }, "anchor")).toBe(true);
      expect(feed.snapshot().invalidCallEvents).toBe(1);
    } finally {
      feed.close();
    }
  });
  it("publishes a new parent fence even when result sampling is throttled", () => {
    const c = new Collector();
    c.start(event("parent"), "anchor");
    c.start(event("child", "parent"), "anchor");
    c.update({ ...event("child", "parent"), type: "tool_execution_update" }, "anchor");
    expect(c.update({ ...event("child", "p".repeat(513)), type: "tool_execution_update" }, "anchor")).toBe(true);
    expect(c.list()[1]?.parentUnavailable).toContain("unavailable");
  });
  for (const phase of ["start", "update", "end"] as const) {
    it.each([undefined, null, "", {}, 42, "x".repeat(513)])(
      `${phase} rejects invalid own IDs %j without retaining or echoing them`,
      (id) => {
        const c = new Collector();
        const e = event(id);
        if (phase === "start") c.start(e, "anchor");
        else if (phase === "update") c.update({ ...e, type: "tool_execution_update" }, "anchor");
        else c.end({ ...e, type: "tool_execution_end" }, "anchor");
        expect(c.list()).toEqual([]);
        expect(c.invalidEvents).toBe(1);
        expect(c.dropped).toBe(0);
        const f = fixture();
        const s = snapshot(f.manager, c, "g", 0, "", [], [], []);
        expect(s.invalidCallEvents).toBe(1);
        expect(JSON.stringify(s)).not.toContain("x".repeat(513));
      },
    );
  }
  it.each([undefined, null, {}, "", "n".repeat(513)])("rejects unsafe names %j", (name) => {
    const c = new Collector();
    c.start({ ...event("valid"), toolName: name as string }, "anchor");
    expect(c.invalidEvents).toBe(1);
    expect(c.list()).toEqual([]);
  });
  it("preserves exact IDs/name/parent/anchor boundaries, original objects and native durations", () => {
    const c = new Collector();
    const id = "i".repeat(512);
    const parent = "p".repeat(512);
    const anchor = "a".repeat(512);
    const e = event(id, parent, "n".repeat(512));
    const before = JSON.stringify(e);
    c.start(e, anchor);
    c.end({ ...e, type: "tool_execution_end", durationMs: 42 }, anchor);
    expect(c.list()[0]).toMatchObject({ id, parentId: parent, branchAnchor: anchor, durationMs: 42, status: "ok" });
    expect(JSON.stringify(e)).toBe(before);
  });
  it.each([null, {}, 42, "", "p".repeat(513)])("fences unsafe parents %j without inventing IDs", (parent) => {
    const c = new Collector();
    c.start(event("child", parent), "anchor");
    const call = c.list()[0];
    expect(call?.parentId).toBeUndefined();
    expect(call?.parentOccurrenceId).toBeUndefined();
    expect(call?.parentUnavailable).toContain("unavailable");
    c.start(event("later"), "anchor");
    expect(call?.parentOccurrenceId).toBeUndefined();
    expect(JSON.stringify(c.list())).not.toContain("p".repeat(513));
  });
  it("fences invalid parent metadata on existing update/end records", () => {
    const c = new Collector();
    c.start(event("parent"), "anchor");
    c.start(event("child", "parent"), "anchor");
    c.update({ ...event("child", "p".repeat(513)), type: "tool_execution_update" }, "anchor");
    c.end({ ...event("child", "p".repeat(513)), type: "tool_execution_end" }, "anchor");
    expect(c.list()[1]?.parentUnavailable).toContain("unavailable");
    expect(c.list()[1]?.parentOccurrenceId).toBeUndefined();
  });
  it.each(["", {}, "a".repeat(513)])("omits unsafe anchors %j", (anchor) => {
    const c = new Collector();
    c.start(event("id"), anchor as string);
    expect(c.list()[0]).toMatchObject({ branchAnchor: null, correlationUnavailable: true });
  });
  it.each([undefined, null, {}, "long", NaN, Infinity, -1])(
    "never publishes malformed native duration %j",
    (durationMs) => {
      const c = new Collector();
      c.end({ ...event("id"), type: "tool_execution_end", durationMs: durationMs as number }, null);
      expect(c.list()[0]?.durationMs).toBeUndefined();
    },
  );
});
