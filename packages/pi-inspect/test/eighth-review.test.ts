import { getCurrentSystemMessage, getCurrentSystemPrompt } from "@earendil-works/pi-ai";
import { buildSessionProjection } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import { Collector } from "../src/collector.js";
import { branch, detail, snapshot } from "../src/projection.js";
import { startServer } from "../src/server.js";
import { SYSTEM_REPLAY_CHARACTERS as LIMIT, systemReplayIssue } from "../src/system-message.js";
import { fixture } from "./fixtures.js";

vi.mock("@earendil-works/pi-ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@earendil-works/pi-ai")>();
  return {
    ...actual,
    getCurrentSystemMessage: vi.fn(actual.getCurrentSystemMessage),
    getCurrentSystemPrompt: vi.fn(actual.getCurrentSystemPrompt),
  };
});
function clearReplay() {
  vi.mocked(getCurrentSystemMessage).mockClear();
  vi.mocked(getCurrentSystemPrompt).mockClear();
}
function noReplay() {
  expect(getCurrentSystemMessage).not.toHaveBeenCalled();
  expect(getCurrentSystemPrompt).not.toHaveBeenCalled();
}
describe("R46: pre-concatenation cumulative native replay budget", () => {
  it("accepts the exact string boundary, rejecting one more character", () => {
    expect(systemReplayIssue([{ role: "system", content: "x".repeat(LIMIT - 2) }])).toBeUndefined();
    expect(systemReplayIssue([{ role: "system", content: "x".repeat(LIMIT - 1) }])).toContain("budget");
  });
  it.each(
    [
      [
        { role: "system", content: "x".repeat(LIMIT / 2) },
        { role: "system", content: "x".repeat(LIMIT / 2) },
      ],
      [{ role: "system", content: [{ type: "text", text: "x".repeat(LIMIT) }] }],
      [{ role: "system", content: "", sections: { rules: "x".repeat(LIMIT) } }],
      [{ role: "system", content: "", sections: { ["k".repeat(LIMIT)]: "x" } }],
      [
        { role: "system", content: "", sections: { rules: "x".repeat(LIMIT / 2) } },
        { role: "system", content: "", sections: { rules: "x".repeat(LIMIT / 2) } },
        { role: "system", content: "", sections: { rules: null } },
      ],
      [{ role: "system", content: Array.from({ length: LIMIT }, () => ({ type: "ignored" })) }],
    ].map((messages) => ({ messages })),
  )("bounds content arrays, section names/values and overwritten/removed input", ({ messages }) =>
    expect(systemReplayIssue(messages)).toContain("budget"),
  );
  it("does not invent a budget for non-system content or mutate input", () => {
    const messages = [
      { role: "user", content: "x".repeat(LIMIT * 2) },
      { role: "system", content: [{ type: "ignored", text: "x".repeat(LIMIT * 2) }], sections: { removed: null } },
    ];
    const before = JSON.stringify(messages);
    expect(systemReplayIssue(messages)).toBeUndefined();
    expect(JSON.stringify(messages)).toBe(before);
  });
  it.each(["content", "sections", "blocks"])("guards ordinary and checkpoint %s before every native join", (field) => {
    for (const checkpoint of [false, true]) {
      const f = fixture();
      const e = f.manager.getEntry(checkpoint ? f.compact : f.system);
      if (!e) throw Error("Missing");
      const m = checkpoint
        ? (e as unknown as { systemMessage: Record<string, unknown> }).systemMessage
        : (e as unknown as { message: Record<string, unknown> }).message;
      Object.assign(
        m,
        field === "content"
          ? { content: "x".repeat(LIMIT) }
          : field === "sections"
            ? { sections: { rules: "x".repeat(LIMIT) } }
            : { content: [{ type: "text", text: "x".repeat(LIMIT) }] },
      );
      const id = checkpoint ? f.leaf : f.user;
      const before = JSON.stringify(f.manager.getEntries());
      clearReplay();
      const result = branch(f.manager, id, 0, []);
      expect(result.ancestryIssue).toContain("budget");
      noReplay();
      expect(detail(f.manager, id, id, new Collector()).raw).toBeDefined();
      noReplay();
      expect(JSON.stringify(f.manager.getEntries())).toBe(before);
    }
  });
  it("checks previous projection independently, but permits discarded oversized history", () => {
    const f = fixture();
    const e = f.manager.getEntry(f.system);
    if (e?.type !== "message") throw Error("Missing");
    Object.assign(e.message, { content: "x".repeat(LIMIT) });
    clearReplay();
    expect(branch(f.manager, f.compact, 0, []).ancestryIssue).toContain("budget");
    noReplay();
    const result = branch(f.manager, f.leaf, 0, []);
    expect(result.ancestryIssue).toBeUndefined();
    expect(result.prompt.value).toBe(
      getCurrentSystemPrompt(buildSessionProjection(f.manager.getEntries(), f.leaf).messages),
    );
  });
  it("keeps a permitted large replay native-correct while bounding the displayed preview", () => {
    const f = fixture();
    const e = f.manager.getEntry(f.system);
    if (e?.type !== "message") throw Error("Missing");
    Object.assign(e.message, { content: "x".repeat(100000) });
    const result = branch(f.manager, f.system, 0, []);
    expect(result.ancestryIssue).toBeUndefined();
    expect(result.prompt.truncated).toBe(true);
    expect(JSON.stringify(result.prompt).length).toBeLessThan(66000);
  });
  it("serves budget diagnostics and bounded raw data over authenticated routes", async () => {
    const f = fixture();
    const e = f.manager.getEntry(f.system);
    if (e?.type !== "message") throw Error("Missing");
    Object.assign(e.message, { content: "x".repeat(LIMIT) });
    const c = new Collector();
    const server = await startServer({
      generation: "g",
      signal: new AbortController().signal,
      snapshot: () => snapshot(f.manager, c, "g", 0, "", [], [], []),
      branch: (id, offset) => branch(f.manager, id, offset, []),
      detail: (id, leaf) => detail(f.manager, id, leaf, c),
    });
    clearReplay();
    try {
      for (const route of ["branch", "detail"]) {
        const response = await fetch(
          `${server.origin}/api/${route}?generation=g&leaf=${f.user}&id=${route === "detail" ? f.system : f.user}`,
          {
            headers: { "X-Inspector-Token": server.token },
          },
        );
        expect(response.status).toBe(200);
        const value = await response.json();
        if (route === "branch") expect(value.ancestryIssue).toContain("budget");
        else {
          expect(value.raw).toBeDefined();
          expect(JSON.stringify(value.raw).length).toBeLessThan(66000);
        }
      }
      noReplay();
    } finally {
      await server.close();
    }
  });
});
