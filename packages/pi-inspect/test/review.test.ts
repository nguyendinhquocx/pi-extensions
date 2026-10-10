import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { type ExtensionAPI, type ExtensionContext, SessionManager } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Collector } from "../src/collector.js";
import { SessionFeed } from "../src/feed.js";
import { capture } from "../src/privacy.js";
import { branch, detail, snapshot } from "../src/projection.js";
import { fixture, skills, tools } from "./fixtures.js";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("R1/R2: coalesced session feed and quiet public actions", () => {
  it("reuses static nodes during streamed partials, bounds notifications and cancels all owned timers", () => {
    vi.useFakeTimers();
    const manager = SessionManager.inMemory("/fixture");
    for (let i = 0; i < 1000; i++) manager.appendMessage({ role: "user", content: "row", timestamp: i });
    const collector = new Collector();
    const signal = new AbortController();
    const invalidate = vi.fn();
    const ctx = { sessionManager: manager, getSystemPrompt: () => "prompt" } as unknown as ExtensionContext;
    const pi = { getAllTools: () => tools, getActiveTools: () => ["read"] } as unknown as ExtensionAPI;
    const feed = new SessionFeed({
      pi,
      context: () => ctx,
      collector,
      skills,
      signal: signal.signal,
      generation: "g",
      invalidate,
    });
    feed.start();
    const first = feed.snapshot();
    const labels = vi.spyOn(manager, "getLabel");
    collector.start({ type: "tool_execution_start", toolCallId: "x", toolName: "read", args: {} }, manager.getLeafId());
    for (let i = 0; i < 100; i++) {
      if (
        collector.update(
          {
            type: "tool_execution_update",
            toolCallId: "x",
            toolName: "read",
            args: {},
            partialResult: { content: "partial" },
          },
          manager.getLeafId(),
        )
      )
        feed.changed(false);
      vi.advanceTimersByTime(10);
      expect(feed.snapshot().nodes).toBe(first.nodes);
    }
    expect(labels).not.toHaveBeenCalled();
    expect(invalidate.mock.calls.length).toBeLessThanOrEqual(4);
    collector.end(
      { type: "tool_execution_end", toolCallId: "x", toolName: "read", isError: false, result: "final" },
      manager.getLeafId(),
    );
    expect(feed.snapshot().calls[0]?.result?.value).toBe("final");
    signal.abort();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("reconciles append/label/name/active/schema changes without public extension events or projections", () => {
    vi.useFakeTimers();
    const f = fixture();
    const controller = new AbortController();
    const invalidate = vi.fn();
    let active = ["read"];
    let inventory = tools;
    const pi = { getAllTools: () => inventory, getActiveTools: () => active } as unknown as ExtensionAPI;
    const ctx = { sessionManager: f.manager, getSystemPrompt: () => "prompt" } as unknown as ExtensionContext;
    const feed = new SessionFeed({
      pi,
      context: () => ctx,
      collector: new Collector(),
      skills,
      signal: controller.signal,
      generation: "g",
      invalidate,
    });
    feed.start();
    feed.snapshot();
    const projection = vi.spyOn(f.manager, "buildSessionProjection");
    active = [];
    f.manager.appendCustomEntry("silent", { value: 1 });
    f.manager.appendLabelChange(f.user, "new label");
    f.manager.appendSessionInfo("new name");
    inventory = tools.map((tool) =>
      tool.name === "read"
        ? {
            ...tool,
            description: "new description",
            parameters: { type: "object", properties: { changed: { type: "string" } } },
          }
        : tool,
    );
    vi.advanceTimersByTime(1250);
    const next = feed.snapshot();
    expect(next.name).toBe("new name");
    expect(next.nodes.find((node) => node.id === f.user)?.label).toBe("new label");
    expect(next.tools.find((tool) => tool.name === "read")).toMatchObject({
      active: false,
      description: "new description",
    });
    expect(JSON.stringify(next.tools)).toContain("changed");
    expect(invalidate).toHaveBeenCalledTimes(1);
    expect(projection).not.toHaveBeenCalled();
    controller.abort();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("R3: historical declaration baseline", () => {
  it("distinguishes missing/partial legacy state from an explicitly empty leading baseline", () => {
    const manager = SessionManager.inMemory("/fixture");
    const legacy = manager.appendMessage({ role: "user", content: "legacy", timestamp: 1 });
    expect(branch(manager, legacy, 0, []).declaredTools.value).toBe("[unavailable: no initial system/tool checkpoint]");
    const delta = manager.appendMessage({
      role: "system",
      content: "",
      toolsAdded: [{ name: "read", description: "read", parameters: { type: "object" } }],
      timestamp: 2,
    });
    expect(branch(manager, delta, 0, []).declaredTools.value).toBe("[unavailable: no initial system/tool checkpoint]");
    manager.resetLeaf();
    const leading = manager.appendMessage({ role: "system", content: "known prompt", timestamp: 3 });
    expect(branch(manager, leading, 0, []).declaredTools.value).toEqual([]);
    const f = fixture();
    expect(JSON.stringify(branch(f.manager, f.assistant, 0, []).declaredTools.value)).toContain("read");
    expect(branch(f.manager, f.compact, 0, []).declaredTools.value).toEqual([]);
  });
});

describe("R5: sanitize before visible budgets", () => {
  it.each([
    `\u001b]0;${"invisible".repeat(1000)}\u0007`,
    `\u001b]0;${"invisible".repeat(1000)}\u001b\\`,
    `\u001b[${"0;".repeat(1000)}31m`,
  ])("does not expose sliced terminal payloads", (controls) => {
    const raw = `${controls}visible text`;
    expect(capture(raw, 40)).toEqual({ value: "visible text", truncated: false });
    expect(raw).toContain("visible text");
  });
  it("sanitizes keys/descriptions before truncation and redacts the clean credential key", () => {
    const osc = `\u001b]0;${"hidden".repeat(100)}\u0007`;
    expect(capture({ [`${osc}api_key`]: "secret" }).value).toEqual({ api_key: "[redacted]" });
    const f = fixture();
    const next = snapshot(
      f.manager,
      new Collector(),
      "g",
      0,
      "",
      [{ ...tools[0], description: `${osc}visible description` } as (typeof tools)[0]],
      [],
      [{ ...skills[0], description: `${osc}visible skill` }],
    );
    expect(next.tools[0]?.description).toBe("visible description");
    expect(next.skills[0]?.description).toBe("visible skill");
  });
});

describe("R6: occurrence identity and historic correlation", () => {
  it("retains repeated roots/derived IDs and associates each result with its owning assistant", () => {
    const f = fixture();
    const collector = new Collector();
    const execute = (anchor: string, value: string) => {
      collector.start(
        { type: "tool_execution_start", toolCallId: "parent", toolName: "codemode", args: { code: value } },
        anchor,
      );
      collector.start(
        {
          type: "tool_execution_start",
          toolCallId: "parent/1",
          parentToolCallId: "parent",
          toolName: "read",
          args: { path: value },
        },
        anchor,
      );
      collector.end(
        {
          type: "tool_execution_end",
          toolCallId: "parent/1",
          parentToolCallId: "parent",
          toolName: "read",
          isError: false,
          result: value,
        },
        anchor,
      );
      collector.end(
        { type: "tool_execution_end", toolCallId: "parent", toolName: "codemode", isError: false, result: value },
        anchor,
      );
    };
    execute(f.assistant, "first");
    collector.settle();
    f.manager.branch(f.result);
    const later = f.manager.appendMessage(
      fauxAssistantMessage([fauxToolCall("codemode", { code: "later" }, { id: "parent" })]),
    );
    f.manager.appendCustomEntry("interstitial", {});
    const result = f.manager.appendMessage({
      role: "toolResult",
      toolCallId: "parent",
      toolName: "codemode",
      content: [{ type: "text", text: "second" }],
      isError: false,
      timestamp: 9,
    });
    execute(later, "second");
    expect(collector.list()).toHaveLength(4);
    expect(collector.dropped).toBe(0);
    expect(new Set(collector.list().map((call) => call.occurrenceId)).size).toBe(4);
    expect(detail(f.manager, f.result, f.result, collector).calls.map((call) => call.result?.value)).toEqual([
      "first",
      "first",
    ]);
    expect(detail(f.manager, result, result, collector).calls.map((call) => call.result?.value)).toEqual([
      "second",
      "second",
    ]);
    expect(
      snapshot(f.manager, collector, "g", 0, "", [], [], []).nodes.find((node) => node.id === result)?.toolAnchor,
    ).toBe(later);
  });
  it("counts evictions of occurrences and does not invent associations for overlapping invalid IDs", () => {
    const collector = new Collector(2);
    for (let i = 0; i < 3; i++) {
      collector.start({ type: "tool_execution_start", toolCallId: "repeat", toolName: "read", args: { i } }, "anchor");
      collector.end(
        { type: "tool_execution_end", toolCallId: "repeat", toolName: "read", isError: false, result: i },
        "anchor",
      );
    }
    expect(collector.list().map((call) => call.result?.value)).toEqual([1, 2]);
    expect(collector.dropped).toBe(1);
    const overlap = new Collector();
    for (let i = 0; i < 2; i++)
      overlap.start({ type: "tool_execution_start", toolCallId: "bad", toolName: "read", args: { i } }, "anchor");
    overlap.end(
      { type: "tool_execution_end", toolCallId: "bad", toolName: "read", isError: false, result: "unmatched end" },
      "anchor",
    );
    expect(overlap.list()).toHaveLength(3);
    expect(overlap.list().every((call) => call.correlationUnavailable)).toBe(true);
    expect(
      overlap
        .list()
        .slice(0, 2)
        .every((call) => !call.result),
    ).toBe(true);
  });
});
