import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test, vi } from "vitest";
import { createRendererHost } from "./fixtures/renderer-host.js";
import { rendererTheme } from "./fixtures/renderer-theme.js";

// A non-interactive smoke: Jiti loads the actual extension fixture, and its lazy
// command runs against real Pi renderers with a scripted terminal. No provider,
// interactive shell, physical terminal, or credentials are needed.
test("Pi Jiti fixture smoke exercises selectors in regular and fullscreen renderers", async (t) => {
  const agentDir = mkdtempSync(path.join(os.tmpdir(), "kit-renderer-smoke-"));
  vi.stubEnv("PI_CODING_AGENT_DIR", agentDir);
  t.onTestFinished(() => {
    vi.unstubAllEnvs();
    rmSync(agentDir, { recursive: true, force: true });
  });
  const { DefaultResourceLoader, SettingsManager } = await import("@earendil-works/pi-coding-agent");
  const loader = new DefaultResourceLoader({
    cwd: agentDir,
    agentDir,
    settingsManager: SettingsManager.inMemory({}),
    additionalExtensionPaths: [path.resolve("packages/pi-tui-kit/test/fixtures/interaction-smoke.ts")],
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
  });
  await loader.reload();
  const loaded = loader.getExtensions();
  t.onTestFinished(() => loaded.runtime.invalidate("smoke complete"));
  assert.deepEqual(loaded.errors, []);
  assert.equal(loaded.extensions.length, 1);
  const command = loaded.extensions[0].commands.get("kit-selector-smoke");
  assert.ok(command);
  for (const mode of ["regular", "fullscreen"] as const) {
    const fixture = createRendererHost(mode, rendererTheme());
    try {
      const running = command.handler("", fixture.ctx);
      await fixture.waitForOpen();
      assert.match(fixture.frame().join("\n"), /Thinking/u);
      fixture.send("\x1b[B");
      fixture.send("\x13");
      await running;
      assert.deepEqual(fixture.notifications, [{ message: "Selector result: saveDefault high", level: "info" }]);
      assert.equal(fixture.host.getFocusedComponent(), fixture.editor);
      assert.equal(fixture.editor.getValue(), "main draft");
    } finally {
      fixture.stop();
    }
  }
});
