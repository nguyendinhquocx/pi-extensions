import { type ExtensionAPI, type ExtensionContext, SessionManager } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ancestry } from "../src/ancestry.js";
import { Collector } from "../src/collector.js";
import { SessionFeed } from "../src/feed.js";
import { sessionName } from "../src/privacy.js";
import { branch, detail, snapshot } from "../src/projection.js";
import { fixture } from "./fixtures.js";

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});
describe("R12: malformed ancestry cannot enter unbounded native traversal", () => {
  it.each(["self", "disconnected", "orphan"] as const)(
    "preserves raw %s evidence and explicitly marks projection unavailable",
    (kind) => {
      const manager = SessionManager.inMemory("/fixture");
      const first = manager.appendCustomEntry("first", {});
      const second = manager.appendCustomEntry("second", {});
      const selected = manager.getEntry(kind === "self" ? second : first);
      if (!selected) throw new Error("Missing fixture");
      selected.parentId = kind === "self" ? second : kind === "orphan" ? "absent" : second;
      const nativeBranch = vi.spyOn(manager, "getBranch").mockImplementation(() => {
        throw new Error("Unsafe native branch must not run");
      });
      const issue = kind === "orphan" ? "missing recorded parent" : "recorded parent cycle";
      expect(branch(manager, selected.id, 0, []).ancestryIssue).toBe(issue);
      const result = detail(manager, selected.id, selected.id, new Collector());
      expect(result.ancestryIssue).toBe(issue);
      expect(result.raw.value).toMatchObject({ id: selected.id, parentId: selected.parentId });
      expect(result.projected.value).toBe(`[unavailable: ${issue}]`);
      expect(result.calls).toEqual([]);
      expect(nativeBranch).not.toHaveBeenCalled();
    },
  );
  it("checks both raw-entry and projected-leaf ancestry, and applies an explicit finite inspection budget", () => {
    const manager = SessionManager.inMemory("/fixture");
    const root = manager.appendCustomEntry("root", {});
    const cyclic = manager.appendCustomEntry("cycle", {});
    const entry = manager.getEntry(cyclic);
    if (!entry) throw new Error("Missing cycle");
    entry.parentId = cyclic;
    expect(detail(manager, root, cyclic, new Collector()).ancestryIssue).toBe("recorded parent cycle");
    expect(detail(manager, cyclic, root, new Collector()).ancestryIssue).toBe("recorded parent cycle");
    manager.branch(root);
    for (let i = 0; i < 10001; i++) manager.appendCustomEntry("deep", {});
    expect(ancestry(manager, manager.getLeafId() ?? "").issue).toContain("inspection budget");
    const f = fixture();
    expect(branch(f.manager, f.compact, 0, []).ancestryIssue).toBeUndefined();
    expect(detail(f.manager, f.assistant, f.compact, new Collector()).ancestryIssue).toBeUndefined();
  });
});
describe("R13: session names are sanitized and bounded before publication/comparison", () => {
  it("retains source data but compares/publishes only a bounded name and truncation evidence", () => {
    vi.useFakeTimers();
    const f = fixture();
    const prefix = `\u001b]0;${"invisible".repeat(1000)}\u0007`;
    const raw = prefix + "visible".repeat(1000);
    f.manager.appendSessionInfo(raw);
    const collector = new Collector();
    const controller = new AbortController();
    const invalidate = vi.fn();
    const ctx = { sessionManager: f.manager, getSystemPrompt: () => "" } as unknown as ExtensionContext;
    const pi = { getAllTools: () => [], getActiveTools: () => [] } as unknown as ExtensionAPI;
    const feed = new SessionFeed({
      pi,
      context: () => ctx,
      collector,
      skills: [],
      generation: "g",
      signal: controller.signal,
      invalidate,
    });
    feed.start();
    const next = feed.snapshot();
    expect(next.name).toHaveLength(512);
    expect(next.name).not.toContain("invisible");
    expect(next.nameTruncated).toBe(true);
    expect(f.manager.getSessionName()).toBe(raw);
    f.manager.appendSessionInfo(prefix + "changed".repeat(1000));
    vi.advanceTimersByTime(1250);
    expect(invalidate).toHaveBeenCalledTimes(1);
    expect(feed.snapshot().name).toBe("changed".repeat(1000).slice(0, 512));
    expect(sessionName(`${"exact".repeat(100)}012345678901`)).toEqual({
      name: `${"exact".repeat(100)}012345678901`,
      nameTruncated: undefined,
    });
    controller.abort();
    expect(vi.getTimerCount()).toBe(0);
    expect(snapshot(f.manager, collector, "g", 0, "", [], [], []).nameTruncated).toBe(true);
  });
});
