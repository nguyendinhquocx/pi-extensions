import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type ExtensionCommandContext, initTheme } from "@earendil-works/pi-coding-agent";
import { test, vi } from "vitest";
import { createCustomSelectorHarness, createMockContext } from "../../../test/support.js";
import { createUsageSettingsRuntime } from "../src/settings.js";
import { showUsageSettings } from "../src/usage-settings-ui.js";

initTheme("dark");

for (const obsolete of [undefined, true, false, null, "true", 1, []]) {
  test(`obsolete companion setting ${JSON.stringify(obsolete)} is ignored and preserved without rewriting on read`, async () => {
    const root = await mkdtemp(join(tmpdir(), "usage-companion-setting-"));
    const path = join(root, "pi-usage.json");
    const document = {
      unrelated: { preserved: true },
      ...(obsolete === undefined ? {} : { openaiCompanionUsage: obsolete }),
    };
    const original = JSON.stringify(document);
    await writeFile(path, original);
    const runtime = createUsageSettingsRuntime(path);
    try {
      assert.equal((await runtime.reload()).kind, "loaded");
      assert.equal(Object.hasOwn(runtime.get().settings, "openaiCompanionUsage"), false);
      assert.equal(await readFile(path, "utf8"), original);
      await runtime.update({ codexFastMode: true });
      assert.deepEqual(JSON.parse(await readFile(path, "utf8")), { ...document, codexFastMode: true });
    } finally {
      await runtime.flush();
      await rm(root, { recursive: true, force: true });
    }
  });
}

test("Settings has no companion option or consent and saves remaining preferences in one screen", async () => {
  const root = await mkdtemp(join(tmpdir(), "usage-companion-ui-"));
  const runtime = createUsageSettingsRuntime(join(root, "pi-usage.json"));
  await runtime.reload();
  const confirm = vi.fn(async () => true);
  let rendered = "";
  let screenCount = 0;
  let applied = 0;
  const controller = new AbortController();
  const context = createMockContext({
    mode: "tui",
    custom: async (factory: unknown) => {
      screenCount++;
      const harness = createCustomSelectorHarness(factory);
      try {
        rendered = harness.render().join("\n");
        harness.handleInput("\r");
        await vi.waitFor(() => assert.equal(runtime.get().settings.codexFastMode, true));
        harness.handleInput("\u0003");
        return await harness.resultPromise;
      } finally {
        harness.dispose();
      }
    },
  });
  Object.assign((context.ctx as ExtensionCommandContext).ui, { confirm });
  try {
    assert.equal(
      await showUsageSettings(
        context.ctx,
        runtime,
        controller.signal,
        () => true,
        () => {
          applied++;
        },
      ),
      true,
    );
    assert.match(rendered, /Codex Fast mode/);
    assert.doesNotMatch(rendered, /companion|Experimental/);
    assert.equal(screenCount, 1);
    assert.equal(confirm.mock.calls.length, 0);
    assert.equal(applied, 1);
  } finally {
    controller.abort();
    await runtime.flush();
    await rm(root, { recursive: true, force: true });
  }
});
