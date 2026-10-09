import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type ExtensionCommandContext, initTheme, type TerminalInputHandler } from "@earendil-works/pi-coding-agent";
import { createTuiHarness } from "@narumitw/pi-tui-kit/testing";
import { test } from "vitest";
import { createMockContext } from "../../../test/support.js";
import { localConfigPath } from "../src/settings/config-file.js";
import { history } from "../src/sync/sync-queries.js";
import { runCancellableOperation } from "../src/ui/cancellable-operation.js";
import { trackOperationDialogs } from "../src/ui/operation-dialogs.js";
import { snapshot, v3S3Settings, withTempHome } from "./helpers.js";
import { MemorySyncBackend } from "./memory-sync-backend.js";

initTheme("dark", false);

function terminalOwner() {
  const listeners = new Set<TerminalInputHandler>();
  return {
    listeners,
    subscribe(handler: TerminalInputHandler) {
      listeners.add(handler);
      return () => {
        listeners.delete(handler);
      };
    },
    send(data: string) {
      for (const handler of listeners) if (handler(data)?.consume) return true;
      return false;
    },
  };
}

for (const phase of ["before-confirm", "after-confirm"] as const) {
  for (const key of ["\u001b", "q", "\u0003"]) {
    test(`History ${phase} remote preflight cancels with ${JSON.stringify(key)} after selector restores editor`, async () => {
      await withTempHome(async (agentDir) => {
        mkdirSync(agentDir, { recursive: true });
        const file = join(agentDir, "settings.json");
        writeFileSync(file, '{"local":true}\n');
        writeFileSync(localConfigPath(), JSON.stringify(v3S3Settings()), { mode: 0o600 });
        const backend = new MemorySyncBackend();
        await backend.publishSnapshot(
          snapshot([{ path: "settings.json", content: Buffer.from('{"remote":true}\n') }]),
          { kind: "missing" },
        );
        const before = await backend.readHead();
        const originalReadHead = backend.readHead.bind(backend);
        let ready!: () => void;
        const preflight = new Promise<void>((resolve) => {
          ready = resolve;
        });
        let reads = 0;
        let activeSignal: AbortSignal | undefined;
        backend.readHead = async (signal) => {
          reads++;
          if (reads === (phase === "before-confirm" ? 1 : 2)) {
            activeSignal = signal;
            ready();
            await new Promise<void>((resolve) => signal?.addEventListener("abort", () => resolve(), { once: true }));
          }
          return originalReadHead(signal);
        };
        const terminal = terminalOwner();
        const tui = createTuiHarness({
          keybindings: {
            matches: (data, action) => action === "tui.select.cancel" && data === key,
            getKeys: (action) => (action === "tui.select.cancel" ? [key === "q" ? "q" : "escape"] : []),
          },
        });
        let focus = "loader";
        let confirmations = 0;
        let confirmationSignal: AbortSignal | undefined;
        const context = createMockContext({ mode: "tui", custom: tui.custom, onTerminalInput: terminal.subscribe });
        const ctx = context.ctx as ExtensionCommandContext;
        // Model Pi's single editor slot: select/confirm replace the custom loader
        // and restore the normal editor, not the loader, when they settle.
        ctx.ui.select = async (_title, labels) => {
          focus = "editor";
          return labels[0];
        };
        ctx.ui.confirm = async (_title, _message, options) => {
          confirmations++;
          confirmationSignal = options?.signal;
          focus = "editor";
          return true;
        };
        const running = runCancellableOperation(
          ctx,
          "Loading history",
          "history",
          async (_route, signal, onCommit, _target, onDialog) => {
            await history(
              trackOperationDialogs(ctx, onDialog),
              {
                args: [],
                yes: false,
                force: false,
                stale: false,
                silent: false,
                reload: false,
                auto: false,
                signal,
                onCommit,
              },
              () => backend,
            );
            return { kind: "completed" };
          },
          { commitAware: true, cancelAcrossDialogs: true },
        );
        try {
          await preflight;
          assert.equal(focus, "editor");
          assert.equal(terminal.send("x"), false);
          assert.equal(activeSignal?.aborted, false);
          assert.equal(terminal.send(key), true);
          assert.deepEqual(await running, { kind: "cancelled" });
          assert.equal(activeSignal?.aborted, true);
          assert.equal(confirmations, phase === "before-confirm" ? 0 : 1);
          if (phase === "after-confirm") assert.equal(confirmationSignal, activeSignal);
          assert.equal(readFileSync(file, "utf8"), '{"local":true}\n');
          assert.deepEqual(await originalReadHead(), before);
          assert.equal(terminal.listeners.size, 0);
          assert.equal(terminal.send(key), false);
        } finally {
          tui.dispose();
        }
      });
    });
  }
}

for (const end of ["complete", "error", "cancel", "dispose", "session-replacement", "shutdown"] as const) {
  test(`History terminal cancellation subscription is released on ${end}`, async () => {
    const terminal = terminalOwner();
    const tui = createTuiHarness();
    const owner = new AbortController();
    const { ctx } = createMockContext({ mode: "tui", custom: tui.custom, onTerminalInput: terminal.subscribe });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let signal: AbortSignal | undefined;
    const running = runCancellableOperation(
      ctx,
      "History",
      "history",
      async (_route, operationSignal) => {
        signal = operationSignal;
        await gate;
        if (end === "error") throw new Error("injected");
        return { kind: "completed" };
      },
      { cancelAcrossDialogs: true, signal: owner.signal },
    );
    try {
      await tui.waitForOpen();
      assert.equal(terminal.listeners.size, 1);
      if (end === "cancel") terminal.send("\u0003");
      if (end === "dispose") tui.dispose();
      if (end === "session-replacement" || end === "shutdown") owner.abort();
      release();
      if (end === "error") await assert.rejects(running, /injected/u);
      else await running;
      assert.equal(terminal.listeners.size, 0);
      if (!["complete", "error"].includes(end)) assert.equal(signal?.aborted, true);
    } finally {
      release();
      tui.dispose();
    }
  });
}

test("History terminal listener consumes hard cancel but cannot abort after commit", async () => {
  const terminal = terminalOwner();
  const tui = createTuiHarness();
  const { ctx, notifications } = createMockContext({
    mode: "tui",
    custom: tui.custom,
    onTerminalInput: terminal.subscribe,
  });
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let signal: AbortSignal | undefined;
  const running = runCancellableOperation(
    ctx,
    "History",
    "history",
    async (_route, operationSignal, onCommit) => {
      signal = operationSignal;
      onCommit?.();
      await gate;
      return { kind: "completed" };
    },
    { commitAware: true, cancelAcrossDialogs: true },
  );
  try {
    await tui.waitForOpen();
    assert.equal(terminal.send("\u0003"), true);
    assert.equal(signal?.aborted, false);
    assert.match(notifications.at(-1)?.message ?? "", /cannot be cancelled safely/u);
    release();
    assert.deepEqual(await running, { kind: "completed" });
    assert.equal(terminal.listeners.size, 0);
  } finally {
    release();
    tui.dispose();
  }
});
