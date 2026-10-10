import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";
import type { EntrySummary } from "../src/model.js";
import { branch, summarize } from "../src/projection.js";
import { history, internalEntry } from "../src/web/history.js";
import { fixture } from "./fixtures.js";

const node = (id: string, parentId: string | null, kind = "user"): EntrySummary => ({
  id,
  parentId,
  kind,
  label: id,
  timestamp: "same",
  internal: ["custom", "label", "session_info", "usage"].includes(kind) ? true : undefined,
});
describe("readable branch history", () => {
  it("orders ancestry rather than timestamps and never groups across a fork", () => {
    const entries = [
      node("root", null, "model_change"),
      node("user", "root"),
      node("a", "user", "assistant"),
      node("b", "user", "assistant"),
      node("result", "a", "toolResult"),
    ];
    const original = JSON.stringify(entries);
    const selected = history(entries, "result");
    expect(selected.rows.map(({ node }) => node.id)).toEqual(["root", "user", "a", "result"]);
    expect(selected.rows.map(({ turn }) => turn)).toEqual(["before-user", "user", "user", "user"]);
    expect(history(entries, "b").rows.map(({ node }) => node.id)).toEqual(["root", "user", "b"]);
    expect(JSON.stringify(entries)).toBe(original);
  });
  it.each([
    "compaction",
    "branch_summary",
    "context_edit",
    "custom_message",
    "model_change",
    "thinking_level_change",
    "system",
    "unknown",
  ])("retains %s", (kind) => expect(internalEntry(node("x", null, kind))).toBe(false));
  it.each(["custom", "label", "session_info", "usage"])("hides only generic bookkeeping %s, never errors", (kind) => {
    expect(internalEntry(node("x", null, kind))).toBe(true);
    expect(internalEntry({ ...node("x", null, kind), status: "error" })).toBe(false);
  });
  it("does not infer bookkeeping from a model-visible legacy custom message role", () => {
    expect(internalEntry({ ...node("x", null, "custom"), internal: undefined })).toBe(false);
    const f = fixture();
    const id = f.manager.appendMessage({
      role: "custom",
      customType: "legacy",
      content: "Model-visible legacy text",
      display: false,
      timestamp: 1,
    });
    const entry = f.manager.getEntry(id);
    if (!entry) throw Error("Missing fixture");
    expect(internalEntry(summarize(entry))).toBe(false);
  });
  it("labels missing parents, unknown leaves, cycles and unavailable active leaf without repair", () => {
    expect(history([node("x", "missing")], "x").issue).toContain("outside indexed");
    expect(history([node("x", "y"), node("y", "x")], "x").issue).toContain("cycle");
    expect(history([], "absent").rows).toEqual([]);
    expect(history([], null).issue).toContain("leaf unavailable");
  });
  it("bounds traversal for hostile long histories", () => {
    const entries = Array.from({ length: 10001 }, (_, i) => node(String(i), i ? String(i - 1) : null));
    const result = history(entries, "10000");
    expect(result.rows).toHaveLength(10000);
    expect(result.issue).toContain("budget exceeded");
  });
  it("summarizes sanitized text and tool arguments without changing session contents", () => {
    const f = fixture();
    const id = f.manager.appendMessage(
      fauxAssistantMessage([fauxToolCall("read", { path: "/example", token: "sensitive" })]),
    );
    const entry = f.manager.getEntry(id);
    if (!entry) throw Error("Missing fixture");
    const original = JSON.stringify(entry);
    expect(summarize(entry).summary).toContain("read");
    expect(summarize(entry).summary).toContain("[redacted]");
    expect(summarize(entry).summary).not.toContain("sensitive");
    expect(JSON.stringify(entry)).toBe(original);
    const long = f.manager.appendMessage({ role: "user", content: `\u001b[31m${"x".repeat(1000)}`, timestamp: 1 });
    const raw = f.manager.getEntry(long);
    if (!raw) throw Error("Missing fixture");
    expect(summarize(raw).summary).toBe("x".repeat(180));
    expect(summarize(raw).summaryTruncated).toBe(true);
  });
  it("branch preview applies native edits and compaction without changing the active leaf", () => {
    const f = fixture();
    const before = f.manager.getLeafId();
    const preview = branch(f.manager, f.leaf, 0, []).context;
    expect(preview?.source).toBe("session-derived");
    expect(preview?.leafId).toBe(f.leaf);
    expect(JSON.stringify(preview)).toContain("summary");
    expect(JSON.stringify(preview)).toContain("after compaction");
    const edit = f.manager.getEntries().find((entry) => entry.type === "context_edit");
    if (!edit) throw Error("Missing edit fixture");
    expect(JSON.stringify(branch(f.manager, edit.id, 0, []).context)).toContain("edited for context only");
    expect(f.manager.getLeafId()).toBe(before);
  });
});
