import type { ExtensionContext, SessionEntry } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import { ancestry } from "../src/ancestry.js";
import { Collector } from "../src/collector.js";
import { identityIssue } from "../src/identity.js";
import { snapshot, summarize } from "../src/projection.js";
import { fixture } from "./fixtures.js";

describe("R14: runtime identity validation", () => {
  const invalid = [undefined, null, 17, {}, [], true, ""];
  it.each(invalid)("rejects malformed entry id %j without publishing a browser node", (id) => {
    const f = fixture();
    const root = f.manager.getEntries()[0];
    if (!root) throw new Error("No root");
    const bad = { ...root, id } as unknown as SessionEntry;
    expect(() => summarize(bad)).toThrow("entry id");
    const manager = new Proxy(f.manager, {
      get(target, name) {
        if (name === "getEntries") return () => [...target.getEntries(), bad];
        return Reflect.get(target, name, target);
      },
    });
    const result = snapshot(manager, new Collector(), "g", 0, "", [], [], []);
    expect(result.nodes.every((node) => typeof node.id === "string")).toBe(true);
    expect(result.invalidEntryCount).toBe(1);
    expect(result.invalidEntries?.[0]?.reason).toContain("entry id");
    expect(result.incomplete).toBe(true);
    expect(bad.id).toBe(id);
  });
  it.each(invalid.filter((value) => value !== null))("rejects malformed parent identity %j", (parentId) => {
    const f = fixture();
    const entry = f.manager.getEntry(f.user);
    if (!entry) throw new Error("No user");
    (entry as unknown as Record<string, unknown>).parentId = parentId;
    expect(identityIssue(entry)).toContain("parent id");
    expect(ancestry(f.manager, f.user).issue).toContain("parent id");
    const result = snapshot(f.manager, new Collector(), "g", 0, "", [], [], []);
    expect(result.nodes.some((node) => node.id === f.user)).toBe(false);
  });
  it("bounds invalid diagnostic samples and refuses malformed leaf values while keeping healthy rows", () => {
    const f = fixture();
    const bad = { type: "custom", id: {}, parentId: null, data: "x".repeat(100000) } as unknown as SessionEntry;
    const manager = new Proxy(f.manager, {
      get(target, name) {
        if (name === "getEntries") return () => [...target.getEntries(), ...Array.from({ length: 25 }, () => bad)];
        if (name === "getLeafId") return () => ({ fake: "leaf" });
        return Reflect.get(target, name, target);
      },
    }) as ExtensionContext["sessionManager"];
    const result = snapshot(manager, new Collector(), "g", 0, "", [], [], []);
    expect(result.leafId).toBeNull();
    expect(result.invalidEntryCount).toBe(25);
    expect(result.invalidEntries).toHaveLength(20);
    expect(JSON.stringify(result.invalidEntries).length).toBeLessThan(50000);
    expect(result.nodes.length).toBe(f.manager.getEntries().length);
  });
});
