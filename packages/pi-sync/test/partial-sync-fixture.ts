import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { createMockContext } from "../../../test/support.js";
import { expectedRemoteHead } from "../src/backends/sync-backend.js";
import type { CommandOptions } from "../src/commands/command-types.js";
import { loadConfig } from "../src/settings/config.js";
import { localConfigPath } from "../src/settings/config-file.js";
import { readStateForConfig } from "../src/state/sync-state-store.js";
import { snapshotFile } from "../src/sync/content-conflicts.js";
import { push } from "../src/sync/sync-mutations.js";
import { v3S3Settings } from "./helpers.js";
import { MemorySyncBackend } from "./memory-sync-backend.js";

export const options: CommandOptions = {
  args: [],
  yes: true,
  force: false,
  stale: false,
  silent: false,
  reload: false,
  auto: false,
};
export async function fixture(root: string, portablePolicy = true) {
  await fs.mkdir(path.join(root, "prompts"), { recursive: true });
  const settings = v3S3Settings({ include: ["settings.json", "AGENTS.md", "prompts"] });
  Object.assign(settings.syncSetups.home.sync, {
    mergeContent: true,
    partialSync: true,
    ...(portablePolicy ? { localFields: [] } : {}),
  });
  await fs.writeFile(localConfigPath(), JSON.stringify({ ...settings, version: 5 }));
  await fs.writeFile(path.join(root, "settings.json"), "{}\n");
  await fs.writeFile(path.join(root, "AGENTS.md"), "a\nb\nc\n");
  await fs.writeFile(path.join(root, "prompts", "safe.md"), "base\n");
  const backend = new MemorySyncBackend();
  const context = createMockContext({ hasUI: true });
  await push(context.ctx, options, undefined, () => backend);
  const config = await loadConfig();
  const state = await readStateForConfig(config);
  return { backend, context, config, state };
}
export async function publish(f: Awaited<ReturnType<typeof fixture>>, values: Record<string, string>) {
  const head = await f.backend.readHead();
  assert.ok(head);
  const original = await f.backend.readSnapshot(head.snapshotRef);
  return f.backend.publishSnapshot(
    {
      ...original,
      id: `remote-${Math.random()}`,
      files: original.files.map((file) =>
        values[file.path] === undefined ? file : snapshotFile(file.path, Buffer.from(values[file.path] ?? "")),
      ),
    },
    expectedRemoteHead(head),
  );
}
