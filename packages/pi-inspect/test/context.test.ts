import { describe, expect, it } from "vitest";
import { captureContext, sessionContext } from "../src/context.js";
import { EntryIndex } from "../src/entry-index.js";
import { fixture } from "./fixtures.js";

describe("composition provenance and bounded capture", () => {
  it("preserves authoritative message/block order, roles, analysis and tools without invented tokens or messages", () => {
    const messages = [
      { role: "system", sections: { prompt: "system instructions" } },
      { role: "user", content: "question" },
      {
        role: "assistant",
        content: [
          { type: "thinking", thinking: "analysis" },
          { type: "text", text: "response" },
          { type: "toolCall", id: "c", name: "read", arguments: { path: "/tmp/a" } },
        ],
        usage: { totalTokens: 999 },
      },
      { role: "toolResult", toolCallId: "c", content: [{ type: "text", text: "result" }] },
    ];
    const before = JSON.stringify(messages);
    const value = captureContext(messages, "observed-pi-context", "leaf");
    expect(value.segments.map((item) => item.category)).toEqual([
      "system",
      "user",
      "assistant",
      "assistant",
      "toolCall",
      "toolResult",
    ]);
    expect(value.segments.map((item) => item.kind)).toEqual(["system", "user", "thinking", "text", "toolCall", "text"]);
    expect(value.segments.map((item) => item.messageIndex)).toEqual([0, 1, 2, 2, 2, 3]);
    expect(value.segments.every((item) => !("tokens" in item))).toBe(true);
    expect(JSON.stringify(messages)).toBe(before);
  });
  it("shows structured system sections without manufacturing a text prompt", () => {
    const value = captureContext(
      [{ role: "system", content: "", sections: { rules: "observed system rules" } }],
      "observed-pi-context",
      null,
    );
    expect(value.segments[0]?.preview).toContain("observed system rules");
    expect(value.messages[0]?.value).toMatchObject({ content: "" });
  });
  it("keeps repeated content independently selectable and existing IDs stable across tail appends", () => {
    const message = { role: "user", content: "same" };
    const first = captureContext([message, message], "observed-pi-context", null);
    const next = captureContext([message, message, { role: "assistant", content: "new" }], "observed-pi-context", null);
    expect(first.segments[0]?.id).not.toBe(first.segments[1]?.id);
    expect(next.segments.slice(0, 2).map((row) => row.id)).toEqual(first.segments.map((row) => row.id));
  });
  it("sanitizes/redacts copied data before summaries, makes traversal/budget truncation explicit, and retains neither accessors nor source mutations", () => {
    const messages = [
      { role: "user", content: "\u001b[31mBearer secret123", headers: { authorization: "private" } },
      ...Array.from({ length: 10000 }, (_, i) => ({ role: "assistant", content: String(i) })),
    ];
    const value = captureContext(messages, "observed-pi-context", null);
    expect(JSON.stringify(value)).not.toContain("secret123");
    expect(JSON.stringify(value)).not.toContain("private");
    expect(value.segments.length).toBeLessThanOrEqual(4000);
    expect(value.incomplete).toBe(true);
    expect(value.totalMessages).toBe(10001);
  });
  it("uses native active-leaf projection rather than all branches/log events and safely labels malformed ancestry", () => {
    const f = fixture();
    const index = new EntryIndex(f.manager.getEntries());
    const value = sessionContext(f.manager, index);
    expect(value.source).toBe("session-derived");
    expect(JSON.stringify(value)).not.toContain("abandoned");
    const entry = f.manager.getEntry(f.leaf);
    if (!entry) throw new Error("No leaf");
    entry.parentId = entry.id;
    const bad = sessionContext(f.manager, new EntryIndex(f.manager.getEntries()));
    expect(bad.unavailable).toContain("cycle");
    expect(bad.segments).toEqual([]);
  });
});
