import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { basename, join } from "node:path";
import { DefaultResourceLoader, type Extension, SettingsManager } from "@earendil-works/pi-coding-agent";
import type { RuntimeBuilder } from "./runtime-builder-contract.js";

/** Own only build/load isolation; callers retain registration and lifecycle assertions. */
export async function withGeneratedRuntime(
  packageRoot: string,
  builder: Pick<RuntimeBuilder, "buildRuntime">,
  run: (extension: Extension) => void | Promise<void>,
): Promise<void> {
  const root = await mkdtemp(join(packageRoot, `.${basename(packageRoot)}-build-test-`));
  const agentDir = join(root, "agent");
  const output = join(root, "dist");
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  try {
    await builder.buildRuntime({ outputDirectory: output });
    await mkdir(agentDir, { recursive: true });
    process.env.PI_CODING_AGENT_DIR = agentDir;
    const loader = new DefaultResourceLoader({
      cwd: root,
      agentDir,
      settingsManager: SettingsManager.inMemory({}),
      additionalExtensionPaths: [join(output, "index.ts")],
    });
    await loader.reload();
    const loaded = loader.getExtensions();
    assert.deepEqual(loaded.errors, []);
    assert.equal(loaded.extensions.length, 1);
    const extension = loaded.extensions[0];
    assert.ok(extension);
    await run(extension);
  } finally {
    if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
    await rm(root, { force: true, recursive: true });
  }
}
