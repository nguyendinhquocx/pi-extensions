import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "vitest";
import { withGeneratedRuntime } from "./generated-runtime-fixture.js";

for (const originalAgentDir of [undefined, "/original-agent-directory"]) {
  for (const outcome of ["success", "build failure", "load failure", "callback failure"] as const) {
    test(`generated-runtime fixture cleans ${outcome} with ${originalAgentDir ? "an existing" : "no"} agent override`, async () => {
      const packageRoot = await mkdtemp(join(tmpdir(), "generated-runtime-fixture-"));
      const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
      if (originalAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
      else process.env.PI_CODING_AGENT_DIR = originalAgentDir;
      let callbackCalled = false;
      try {
        const operation = withGeneratedRuntime(
          packageRoot,
          {
            async buildRuntime({ outputDirectory } = {}) {
              assert.ok(outputDirectory);
              assert.equal(process.env.PI_CODING_AGENT_DIR, originalAgentDir);
              await mkdir(outputDirectory);
              if (outcome === "build failure") throw new Error(outcome);
              await writeFile(
                join(outputDirectory, "index.ts"),
                outcome === "load failure"
                  ? 'export default function () { throw new Error("load failure"); }'
                  : 'export default function (pi) { pi.registerCommand("fixture", { handler: async () => {} }); }',
              );
              return {};
            },
          },
          (extension) => {
            callbackCalled = true;
            assert.ok(extension.commands.has("fixture"));
            const agentDir = process.env.PI_CODING_AGENT_DIR;
            assert.ok(agentDir);
            assert.equal(dirname(dirname(agentDir)), packageRoot);
            if (outcome === "callback failure") throw new Error(outcome);
          },
        );
        if (outcome === "success") await operation;
        else if (outcome === "load failure") await assert.rejects(operation, /load failure/u);
        else await assert.rejects(operation, new RegExp(outcome, "u"));
        assert.equal(callbackCalled, outcome === "success" || outcome === "callback failure");
        assert.equal(process.env.PI_CODING_AGENT_DIR, originalAgentDir);
        assert.deepEqual(await readdir(packageRoot), []);
      } finally {
        if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
        else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
        await rm(packageRoot, { recursive: true, force: true });
      }
    });
  }
}
