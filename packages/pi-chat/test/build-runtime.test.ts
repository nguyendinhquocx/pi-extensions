import assert from "node:assert/strict";
import { test } from "vitest";
import { withGeneratedRuntime } from "../../../test/generated-runtime-fixture.js";
import { registerRuntimeBuilderContract } from "../../../test/runtime-builder-contract.js";

const { packageRoot, loadBuilder } = registerRuntimeBuilderContract({
  packageId: "pi-chat",
  forbiddenEagerInputs: [
    "src/network.ts",
    "src/directory-network.ts",
    "src/menu.ts",
    "src/chat-view.ts",
    "src/widget.ts",
  ],
  forbiddenEagerExternals: ["@narumitw/pi-tui-kit"],
});

test("generated runtime is loadable by Pi's Jiti resource loader", async () => {
  await withGeneratedRuntime(packageRoot, await loadBuilder(), (extension) => {
    assert.ok(extension?.commands.has("chat"));
    assert.ok(extension?.handlers.has("session_start"));
    assert.ok(extension?.handlers.has("session_shutdown"));
  });
});
