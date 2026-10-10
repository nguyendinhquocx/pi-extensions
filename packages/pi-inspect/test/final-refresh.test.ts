import { fauxAssistantMessage, fauxToolCall, getCurrentSystemPrompt } from "@earendil-works/pi-ai";
import { buildSessionProjection } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import { Collector } from "../src/collector.js";
import { correlatedCalls } from "../src/correlation.js";
import { identityIssue } from "../src/identity.js";
import { capture, readSessionId } from "../src/privacy.js";
import { branch, detail } from "../src/projection.js";
import { fixture, skills } from "./fixtures.js";

describe("R57/R58 session display and persisted identities", () => {
  it.each(["x".repeat(513), "", undefined, null, {}])("omits invalid display ID %j without echoing", (id) => {
    expect(readSessionId({ getSessionId: () => id as string })).toContain("unavailable");
  });
  it("preserves exact session ID input and sanitizes only its display copy", () => {
    const id = "\x1b[31mvalid\x1b[0m";
    expect(readSessionId({ getSessionId: () => id })).toBe("valid");
    expect(readSessionId({ getSessionId: () => "x".repeat(512) })).toHaveLength(512);
    expect(id).toContain("\x1b");
  });
  it.each(["id", "name"])("rejects empty/over-budget persisted %s and keeps exact boundary", (field) => {
    const f = fixture();
    const e = f.manager.getEntry(f.assistant);
    if (e?.type !== "message" || e.message.role !== "assistant") throw Error("Missing");
    const block = e.message.content[0];
    if (block.type !== "toolCall") throw Error("Missing");
    Object.assign(block, { [field]: "x".repeat(512) });
    expect(identityIssue(e)).toBeUndefined();
    for (const value of ["", "x".repeat(513)]) {
      Object.assign(block, { [field]: value });
      expect(identityIssue(e)).toContain("tool-call");
    }
  });
});
describe("R49/R54 native selected envelope and structural safety", () => {
  it("skips an older malformed checkpoint while retaining its real parent and native valid newest context", () => {
    const f = fixture();
    f.manager.branch(f.compact);
    const newest = f.manager.appendCompaction("new", f.compact, 900);
    const old = f.manager.getEntry(f.compact);
    if (!old) throw Error("Missing");
    Object.assign(old, { systemMessage: { role: "system", content: {} } });
    const leaf = f.manager.appendMessage({ role: "user", content: "after", timestamp: 1 });
    const result = branch(f.manager, leaf, 0, []);
    expect(result.ancestryIssue).toBeUndefined();
    expect(result.prompt.value).toBe(
      getCurrentSystemPrompt(buildSessionProjection(f.manager.getEntries(), leaf).messages),
    );
    expect(detail(f.manager, leaf, leaf, new Collector()).ancestryIssue).toBeUndefined();
    expect(f.manager.getEntry(newest)?.parentId).toBe(f.compact);
  });
  it("validates the edited projected content instead of an obsolete malformed body", () => {
    const f = fixture();
    f.manager.branch(f.assistant);
    const leaf = f.manager.appendContextEdit(f.assistant, { content: [] });
    const e = f.manager.getEntry(f.assistant);
    if (e?.type !== "message") throw Error("Missing");
    Object.assign(e.message, { content: {} });
    expect(branch(f.manager, leaf, 0, []).ancestryIssue).toBeUndefined();
  });
  it("rejects oversized/sparse arrays before reading elements", () => {
    const f = fixture();
    const e = f.manager.getEntry(f.assistant);
    if (e?.type !== "message") throw Error("Missing");
    const content = new Array(2049);
    Object.defineProperty(content, "0", {
      get() {
        throw Error("Must not scan");
      },
    });
    Object.assign(e.message, { content });
    expect(identityIssue(e)).toContain("budget");
    Object.assign(e.message, { content: Array.from({ length: 2048 }, () => ({ type: "future" })) });
    expect(identityIssue(e)).toBeUndefined();
  });
  it("does not ignore a structural parent cycle after compaction", () => {
    const f = fixture();
    const old = f.manager.getEntry(f.system);
    if (!old) throw Error("Missing");
    old.parentId = f.leaf;
    expect(branch(f.manager, f.leaf, 0, []).ancestryIssue).toContain("cycle");
  });
});
describe("R50 same-anchor multiplicity", () => {
  it("fences sequential occurrences/descendants but not different anchors", () => {
    const c = new Collector();
    const start = (anchor: string) =>
      c.start({ type: "tool_execution_start", toolCallId: "same", toolName: "read", args: {} }, anchor);
    start("a");
    c.start(
      { type: "tool_execution_start", toolCallId: "child", parentToolCallId: "same", toolName: "read", args: {} },
      "a",
    );
    c.end({ type: "tool_execution_end", toolCallId: "same", toolName: "read", result: "one", isError: false }, "a");
    start("a");
    expect(c.list().every((call) => call.correlationUnavailable)).toBe(true);
    expect(correlatedCalls(new Set(["same"]), "a", c.list())).toEqual([]);
    c.end({ type: "tool_execution_end", toolCallId: "same", toolName: "read", result: "two", isError: false }, "a");
    start("b");
    expect(correlatedCalls(new Set(["same"]), "b", c.list())).toHaveLength(1);
  });
});
describe("R53 exact AWS secret-access-key field", () => {
  it.each([
    "secretAccessKey",
    "awsSecretAccessKey",
    "AWS_SECRET_ACCESS_KEY",
    "secret_access_key",
    "service-secret-access-key",
  ])("redacts %s, not public IDs/metrics", (key) => {
    const source = { [key]: "secret", accessKeyId: "public", secretAccessKeyCount: 2 };
    const result = capture(source);
    expect(result.value).toMatchObject({ [key]: "[redacted]", accessKeyId: "public", secretAccessKeyCount: 2 });
    expect(source[key]).toBe("secret");
  });
});
describe("R55/R56 bounded and truthful skill evidence", () => {
  it.each([undefined, null, true, false])("requires explicit success %j", (isError) => {
    const f = fixture();
    f.manager.branch(f.user);
    f.manager.appendMessage(fauxAssistantMessage([fauxToolCall("read", { path: skills[0].path }, { id: "skill" })]));
    const leaf = f.manager.appendMessage({
      role: "toolResult",
      toolCallId: "skill",
      toolName: "read",
      content: [],
      timestamp: 1,
      isError: false,
    });
    const e = f.manager.getEntry(leaf);
    if (e?.type !== "message") throw Error("Missing");
    Object.assign(e.message, { isError });
    const result = branch(f.manager, leaf, 0, skills);
    expect(result.skillEvidence.value).toHaveLength(isError === false ? 1 : 0);
  });
  it("bounds nested scans and evidence allocation, checks type/status before lookup", () => {
    const f = fixture();
    const e = f.manager.getEntry(f.result);
    if (e?.type !== "message") throw Error("Missing");
    const calls = Array.from({ length: 10000 }, (_, i) => ({
      id: String(i),
      name: "read",
      status: "ok",
      arguments: { path: skills[0].path },
    }));
    Object.assign(e.message, { nestedCalls: { calls, complete: true } });
    const result = branch(f.manager, f.result, 0, skills);
    expect(result.skillEvidence.truncated).toBe(true);
    expect((result.skillEvidence.value as unknown[]).length).toBeLessThanOrEqual(256);
  });
});
