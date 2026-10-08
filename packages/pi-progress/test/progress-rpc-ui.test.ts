import assert from "node:assert/strict";
import { test, vi } from "vitest";
import { COMPLETION_SUMMARY_MS, WIDGET_KEY } from "../src/progress-widget.js";
import { createContext, createHarness, loadedSettings, setProgress } from "./progress-harness.js";

test("context UI defaults match Pi modes and preserve explicit overrides", () => {
  for (const mode of ["tui", "rpc", "print", "json"] as const) {
    assert.equal(createContext({ mode }).ctx.hasUI, mode === "tui" || mode === "rpc", mode);
    for (const hasUI of [true, false]) {
      assert.equal(createContext({ mode, hasUI }).ctx.hasUI, hasUI, `${mode}: ${hasUI}`);
    }
  }
  assert.equal(createContext().ctx.hasUI, true);
});

test("renders and clears progress widgets in UI-capable RPC sessions", async () => {
  const harness = createHarness();
  const current = createContext({ mode: "rpc" });

  await harness.emit("session_start", current.ctx);
  await setProgress(harness, current.ctx, [{ text: "web progress", status: "in_progress" }]);

  const widget = current.widgets.at(-1);
  assert.equal(widget?.key, WIDGET_KEY);
  assert.equal(widget?.options?.placement, "aboveEditor");
  assert.equal(widget?.content, undefined);
  assert.equal(widget?.lines?.at(-1), "▶ web progress");
  assert.equal(widget?.lines?.[0], "─".repeat(80));

  await harness.emit("session_shutdown", current.ctx);
  assert.deepEqual(current.widgets.at(-1), { key: WIDGET_KEY, content: undefined, options: undefined });
});

test("RPC mock ignores factories but emits string arrays and clears", () => {
  const current = createContext({ mode: "rpc" });
  current.ctx.ui.setWidget(WIDGET_KEY, () => ({ render: () => ["ignored"], invalidate() {} }));
  assert.equal(current.widgets.length, 0);
  current.ctx.ui.setWidget(WIDGET_KEY, ["visible"]);
  assert.deepEqual(current.widgets.at(-1)?.lines, ["visible"]);
  current.ctx.ui.setWidget(WIDGET_KEY, undefined);
  assert.equal(current.widgets.at(-1)?.lines, undefined);
});

for (const boundary of ["expiry", "update", "clear", "tree", "replacement", "shutdown"] as const) {
  test(`RPC completion summary respects ${boundary}`, async () => {
    vi.useFakeTimers();
    const harness = createHarness();
    const current = createContext({ mode: "rpc" });
    const replacement = createContext({ mode: "rpc" });
    try {
      await harness.emit("session_start", current.ctx);
      await setProgress(harness, current.ctx, [{ text: "finish", status: "in_progress" }]);
      await setProgress(harness, current.ctx, [{ text: "finish", status: "completed" }]);
      assert.deepEqual(current.widgets.at(-1)?.lines, ["─".repeat(80), "✓ 1/1 steps completed"]);
      if (boundary === "update") await setProgress(harness, current.ctx, [{ text: "new", status: "pending" }]);
      if (boundary === "clear") await setProgress(harness, current.ctx, []);
      if (boundary === "tree") await harness.emit("session_tree", current.ctx);
      if (boundary === "replacement") await harness.emit("session_start", replacement.ctx);
      if (boundary === "shutdown") await harness.emit("session_shutdown", current.ctx);
      const count = current.widgets.length;
      await vi.advanceTimersByTimeAsync(COMPLETION_SUMMARY_MS);
      assert.equal(current.widgets.length, count + (boundary === "expiry" ? 1 : 0));
      assert.equal(current.widgets.at(-1)?.lines?.at(-1), boundary === "update" ? "○ new" : undefined);
    } finally {
      await harness.emit("session_shutdown", boundary === "replacement" ? replacement.ctx : current.ctx);
      assert.equal(vi.getTimerCount(), 0);
      vi.useRealTimers();
    }
  });
}

test("RPC snapshots honor settings and sanitize progress text", async () => {
  const harness = createHarness({
    loadSettings: async () => loadedSettings({ showProgress: false, showCompleted: false, maxVisibleItems: 1 }),
  });
  const current = createContext({ mode: "rpc" });
  await harness.emit("session_start", current.ctx);
  await setProgress(harness, current.ctx, [
    { text: "done", status: "completed" },
    { text: "active\u001b[31m\u202e", status: "in_progress" },
    { text: "later", status: "pending" },
  ]);
  const lines = current.widgets.at(-1)?.lines ?? [];
  assert.equal(lines[1], "Progress");
  assert.equal(
    lines.some((line) => line.includes("done")),
    false,
  );
  assert.equal(lines.join("\n").includes("\u001b"), false);
  assert.equal(lines.join("\n").includes("\u202e"), false);
  assert.equal(lines.at(-1), "… 1 more");
  await harness.emit("session_shutdown", current.ctx);

  const disabled = createHarness({ loadSettings: async () => loadedSettings({ enabled: false }) });
  const headless = createContext({ mode: "rpc" });
  await disabled.emit("session_start", headless.ctx);
  await setProgress(disabled, headless.ctx, [{ text: "hidden", status: "completed" }]);
  assert.equal(
    headless.widgets.some(({ lines }) => lines !== undefined),
    false,
  );
  await disabled.emit("session_shutdown", headless.ctx);
});

test("keeps genuinely headless modes free of progress widgets", async () => {
  for (const mode of ["print", "json"] as const) {
    const harness = createHarness();
    const current = createContext({ mode });

    await harness.emit("session_start", current.ctx);
    await setProgress(harness, current.ctx, [{ text: "headless", status: "pending" }]);

    assert.equal(current.widgets.length, 0, mode);
  }
});
