import { getCurrentSystemPrompt, getCurrentTools } from "@earendil-works/pi-ai";
import { buildSessionProjection } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import { Collector } from "../src/collector.js";
import { identityIssue } from "../src/identity.js";
import { capture } from "../src/privacy.js";
import { branch, detail, snapshot } from "../src/projection.js";
import { startServer } from "../src/server.js";
import { fixture } from "./fixtures.js";

describe("R36: sanitized camel/acronym credential boundaries", () => {
  it.each([
    "openaiApiKey",
    "githubToken",
    "xApiKey",
    "xAPIKey",
    "openaiAPIKEY",
    "serviceClientSecret",
    "providerPrivateKey",
    "proxyAuthorization",
    "openai\x1b[31mApiKey\x1b[0m",
  ])("redacts %s without mutating source", (key) => {
    const source = {
      [key]: "secret-value",
      tokenCount: 42,
      apiKeyCount: 2,
      tokenize: "ordinary",
      privateKeyLabel: "description",
    };
    const value = capture(source);
    expect(JSON.stringify(value)).not.toContain("secret-value");
    expect(JSON.stringify(value)).toContain("ordinary");
    expect(JSON.stringify(value)).toContain("description");
    expect(value.value).toMatchObject({ tokenCount: 42, apiKeyCount: 2 });
    expect(source[key]).toBe("secret-value");
  });
});
describe("R38: remaining persisted summary bounds", () => {
  it("accepts exact string-budget boundaries without rewriting identities", () => {
    const f = fixture();
    const r = f.manager.getEntry(f.result);
    if (r?.type !== "message") throw Error("No result");
    r.timestamp = "t".repeat(512);
    Object.assign(r.message, { toolCallId: "i".repeat(512) });
    expect(identityIssue(r)).toBeUndefined();
    const node = snapshot(f.manager, new Collector(), "g", 0, "", [], [], []).nodes.find(
      (node) => node.id === f.result,
    );
    expect(node?.timestamp).toBe(r.timestamp);
    expect(node?.toolCallId).toBe("i".repeat(512));
  });
  it.each(["timestamp", "toolCallId"])("rejects oversized %s with bounded raw evidence", (field) => {
    const f = fixture();
    const r = f.manager.getEntry(f.result);
    if (r?.type !== "message") throw Error("No result");
    if (field === "timestamp") r.timestamp = "x".repeat(100000);
    else Object.assign(r.message, { toolCallId: "x".repeat(100000) });
    const s = snapshot(f.manager, new Collector(), "g", 0, "", [], [], []);
    expect(s.nodes.some((node) => node.id === f.result)).toBe(false);
    expect(s.invalidEntries?.some((item) => item.reason.includes("budget"))).toBe(true);
    expect(JSON.stringify(s).length).toBeLessThan(20000);
    const d = detail(f.manager, f.result, f.result, new Collector());
    expect(d.ancestryIssue).toContain("budget");
    expect(JSON.stringify(d.raw).length).toBeLessThan(70000);
  });
  it.each([undefined, null, {}, [], 42, true])("diagnoses non-string result IDs %j", (id) => {
    const f = fixture();
    const r = f.manager.getEntry(f.result);
    if (r?.type !== "message") throw Error("No result");
    Object.assign(r.message, { toolCallId: id });
    expect(identityIssue(r)).toContain("tool-result");
    expect(() => detail(f.manager, f.result, f.result, new Collector())).not.toThrow();
  });
});
describe("R39: context-edit native replacement classes", () => {
  it("serves edit and descendant raw evidence over authenticated branch/detail routes", async () => {
    const f = fixture();
    f.manager.branch(f.user);
    const id = f.manager.appendContextEdit(f.user, { content: "valid" });
    const edit = f.manager.getEntry(id);
    if (!edit) throw Error("No edit");
    delete (edit as unknown as Record<string, unknown>).replacement;
    const leaf = f.manager.appendCustomEntry("descendant", {});
    const c = new Collector();
    const server = await startServer({
      generation: "g",
      signal: new AbortController().signal,
      snapshot: () => snapshot(f.manager, c, "g", 0, "", [], [], []),
      branch: (selected, offset) => branch(f.manager, selected, offset, []),
      detail: (selected, current) => detail(f.manager, selected, current, c),
    });
    try {
      for (const selected of [id, leaf])
        for (const route of ["branch", "detail"]) {
          const response = await fetch(`${server.origin}/api/${route}?generation=g&id=${selected}&leaf=${selected}`, {
            headers: { "X-Inspector-Token": server.token },
          });
          expect(response.status).toBe(200);
          const result = await response.json();
          expect(result.ancestryIssue).toContain("replacement");
          if (route === "detail") expect(result.raw).toBeDefined();
        }
    } finally {
      await server.close();
    }
  });
  it.each([
    undefined,
    {},
    [],
    42,
    true,
    "bad",
    { content: undefined },
    { content: null },
    { content: 42 },
    { content: [null] },
    { content: [[]] },
  ])("retains raw evidence for unsafe replacement %j", (replacement) => {
    const f = fixture();
    f.manager.branch(f.user);
    const id = f.manager.appendContextEdit(f.user, { content: "valid" });
    const edit = f.manager.getEntry(id);
    if (!edit) throw Error("No edit");
    Object.assign(edit, { replacement });
    const leaf = f.manager.appendCustomEntry("descendant", {});
    const before = JSON.stringify(f.manager.getEntries());
    for (const selected of [id, leaf]) {
      expect(branch(f.manager, selected, 0, []).ancestryIssue).toContain("replacement");
      expect(detail(f.manager, selected, selected, new Collector()).raw).toBeDefined();
    }
    expect(JSON.stringify(f.manager.getEntries())).toBe(before);
  });
  it.each([
    null,
    { content: "" },
    { content: "new" },
    { content: [] },
    { content: [{ type: "text" as const, text: "new" }] },
  ])("preserves native replay for valid replacement %j", (replacement) => {
    const f = fixture();
    f.manager.branch(f.user);
    const id = f.manager.appendContextEdit(f.user, replacement);
    const entries = f.manager.getEntries();
    const native = buildSessionProjection(entries, id);
    const result = branch(f.manager, id, 0, []);
    expect(result.ancestryIssue).toBeUndefined();
    expect(result.projection.value).toEqual(
      JSON.parse(
        JSON.stringify(native.entries.map((entry) => ({ id: entry.sourceEntry.id, messages: entry.messages }))),
      ),
    );
    expect(identityIssue(f.manager.getEntry(id))).toBeUndefined();
  });
  it.each(["assistant", "toolResult", "custom"] as const)(
    "matches native replacement normalization for %s targets",
    (role) => {
      for (const replacement of [
        null,
        { content: "" },
        { content: "new" },
        { content: [] },
        { content: [{ type: "text" as const, text: "new" }] },
      ]) {
        const f = fixture();
        const target =
          role === "assistant"
            ? f.assistant
            : role === "toolResult"
              ? f.result
              : f.manager.appendCustomMessageEntry("example", "old", false, {});
        f.manager.branch(target);
        const id = f.manager.appendContextEdit(target, { content: "initial" });
        Object.assign(f.manager.getEntry(id) ?? {}, { replacement }); // Loaded edit strings need not be writer-normalized.
        const native = buildSessionProjection(f.manager.getEntries(), id);
        const result = branch(f.manager, id, 0, []);
        expect(result.ancestryIssue).toBeUndefined();
        expect(result.projection.value).toEqual(
          JSON.parse(
            JSON.stringify(native.entries.map((entry) => ({ id: entry.sourceEntry.id, messages: entry.messages }))),
          ),
        );
      }
    },
  );
  it.each([undefined, null, {}, [], 42, "", "x".repeat(513)])(
    "rejects malformed target %j without replay",
    (targetId) => {
      const f = fixture();
      f.manager.branch(f.user);
      const id = f.manager.appendContextEdit(f.user, null);
      Object.assign(f.manager.getEntry(id) ?? {}, { targetId });
      expect(branch(f.manager, id, 0, []).ancestryIssue).toContain("target");
    },
  );
});
describe("R41: complete system fields consumed by native replay", () => {
  it("serves malformed system and descendant raw details over authenticated routes", async () => {
    const f = fixture();
    const system = f.manager.getEntry(f.system);
    if (system?.type !== "message") throw Error("No system");
    Object.assign(system.message, { content: { bad: true } });
    const c = new Collector();
    const server = await startServer({
      generation: "g",
      signal: new AbortController().signal,
      snapshot: () => snapshot(f.manager, c, "g", 0, "", [], [], []),
      branch: (id, offset) => branch(f.manager, id, offset, []),
      detail: (id, leaf) => detail(f.manager, id, leaf, c),
    });
    try {
      for (const id of [f.system, f.result])
        for (const route of ["branch", "detail"]) {
          const response = await fetch(`${server.origin}/api/${route}?generation=g&id=${id}&leaf=${id}`, {
            headers: { "X-Inspector-Token": server.token },
          });
          expect(response.status).toBe(200);
          const body = await response.json();
          expect(body.ancestryIssue).toContain("system-message content");
          if (route === "detail") expect(body.raw).toBeDefined();
        }
    } finally {
      await server.close();
    }
  });
  it.each([{}, 42, true, [null], [[]], [{ type: "text", text: {} }]])(
    "diagnoses unsafe content %j and retains selected/descendant raw evidence",
    (content) => {
      const f = fixture();
      const system = f.manager.getEntry(f.system);
      if (system?.type !== "message") throw Error("No system");
      Object.assign(system.message, { content });
      const before = JSON.stringify(f.manager.getEntries());
      for (const selected of [f.system, f.result]) {
        expect(branch(f.manager, selected, 0, []).ancestryIssue).toContain("system-message content");
        expect(detail(f.manager, selected, selected, new Collector()).raw).toBeDefined();
      }
      expect(JSON.stringify(f.manager.getEntries())).toBe(before);
    },
  );
  it.each([
    ["sections", []],
    ["sections", { rule: undefined }],
    ["sections", { rule: {} }],
    ["sections", 42],
    ["toolsAdded", {}],
    ["toolsAdded", [null]],
    ["toolsAdded", [{ name: {} }]],
    ["toolsRemoved", {}],
    ["toolsRemoved", [null]],
  ])("diagnoses malformed %s %j before replay", (key, value) => {
    const f = fixture();
    const system = f.manager.getEntry(f.system);
    if (system?.type !== "message") throw Error("No system");
    Object.assign(system.message, { [key]: value });
    expect(branch(f.manager, f.result, 0, []).ancestryIssue).toContain("system-message");
    expect(detail(f.manager, f.result, f.result, new Collector()).raw).toBeDefined();
  });
  it.each(["", [], [{ type: "text", text: "base" }], [{ type: "future", text: "ignored" }]])(
    "matches native prompt/tool replay for safe content %j",
    (content) => {
      const f = fixture();
      const system = f.manager.getEntry(f.system);
      if (system?.type !== "message") throw Error("No system");
      Object.assign(system.message, { content, sections: { removed: null, kept: "rule" } });
      const messages = buildSessionProjection(f.manager.getEntries(), f.result).messages;
      const result = branch(f.manager, f.result, 0, []);
      expect(result.ancestryIssue).toBeUndefined();
      expect(result.prompt.value).toBe(getCurrentSystemPrompt(messages));
      expect(result.declaredTools.value).toEqual(JSON.parse(JSON.stringify(getCurrentTools(messages))));
    },
  );
  it("retains native absent/null optional metadata as a no-op", () => {
    const f = fixture();
    const system = f.manager.getEntry(f.system);
    if (system?.type !== "message") throw Error("No system");
    Object.assign(system.message, { content: "", sections: null, toolsAdded: null, toolsRemoved: null });
    expect(branch(f.manager, f.system, 0, []).ancestryIssue).toBeUndefined();
    expect(branch(f.manager, f.system, 0, []).declaredTools.value).toEqual([]);
  });
});
describe("R40: native title-clear equivalence", () => {
  it.each([undefined, "", "  ", "valid"])("retains supported title %j", (name) => {
    const f = fixture();
    const id = f.manager.appendSessionInfo("previous");
    const e = f.manager.getEntry(id);
    if (!e) throw Error("No title");
    Object.assign(e, { name });
    expect(identityIssue(e)).toBeUndefined();
    expect(f.manager.getSessionName()).toBe(typeof name === "string" ? name.trim() || undefined : undefined);
    const view = snapshot(f.manager, new Collector(), "g", 0, "", [], [], []);
    expect(view.nodes.some((node) => node.id === id)).toBe(true);
    expect(view.invalidEntryCount).toBe(0);
  });
  it.each([null, {}, [], 42, true])("diagnoses unsupported title %j", (name) => {
    const f = fixture();
    const id = f.manager.appendSessionInfo("previous");
    Object.assign(f.manager.getEntry(id) ?? {}, { name });
    expect(identityIssue(f.manager.getEntry(id))).toContain("session name");
    expect(() => snapshot(f.manager, new Collector(), "g", 0, "", [], [], [])).not.toThrow();
  });
});
