import assert from "node:assert/strict";
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { test } from "vitest";

// This is a native platform smoke, not an os=darwin simulation. Run it
// after a clean macOS install with fsevents installation scripts denied.
test.skipIf(process.platform !== "darwin")("denied fsevents scripts preserve native macOS file watching", async () => {
  const require = createRequire(import.meta.url);
  const fsevents = require("fsevents") as {
    watch(directory: string, callback: (filename: string) => void): () => Promise<void>;
  };
  const directory = await mkdtemp(path.join(await realpath(os.tmpdir()), "pi-fsevents-"));
  let stop: (() => Promise<void>) | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    let observed: () => void = () => {};
    const event = new Promise<void>((resolve, reject) => {
      observed = resolve;
      timer = setTimeout(() => reject(new Error("Native fsevents did not observe the file write")), 3_000);
    });
    stop = fsevents.watch(directory, (filename) => {
      if (path.basename(filename) === "probe") observed();
    });
    await writeFile(path.join(directory, "probe"), "watcher smoke\n");
    await event;
    assert.ok(stop);
  } finally {
    clearTimeout(timer);
    await stop?.();
    await rm(directory, { recursive: true, force: true });
  }
});
