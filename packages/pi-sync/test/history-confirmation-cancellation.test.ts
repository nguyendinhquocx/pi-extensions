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

for (const end of [
  "reject",
  "cancel",
  "session-replacement",
  "shutdown",
  "dispose",
  "stale-owner-reject",
  "stale-owner-accept",
] as const) {
  test(`History rollback confirmation handles ${end} without stale or duplicate notifications`, async () => {
    await withTempHome(async (agentDir) => {
      mkdirSync(agentDir, { recursive: true });
      const file = join(agentDir, "settings.json");
      writeFileSync(file, '{"local":true}\n');
      writeFileSync(localConfigPath(), JSON.stringify(v3S3Settings()), { mode: 0o600 });
      const backend = new MemorySyncBackend();
      await backend.publishSnapshot(snapshot([{ path: "settings.json", content: Buffer.from('{"remote":true}\n') }]), {
        kind: "missing",
      });
      const before = await backend.readHead();
      const owner = new AbortController();
      const listeners = new Set<TerminalInputHandler>();
      const tui = createTuiHarness();
      const context = createMockContext({
        mode: "tui",
        custom: tui.custom,
        onTerminalInput(handler: TerminalInputHandler) {
          listeners.add(handler);
          return () => {
            listeners.delete(handler);
          };
        },
      });
      const ctx = context.ctx as ExtensionCommandContext;
      ctx.ui.select = async (_title, labels) => labels[0];
      let ready!: () => void;
      const confirmationOpened = new Promise<void>((resolve) => {
        ready = resolve;
      });
      let finishConfirmation!: (confirmed: boolean) => void;
      let confirmationSignal: AbortSignal | undefined;
      ctx.ui.confirm = async (_title, _message, options) => {
        confirmationSignal = options?.signal;
        return new Promise<boolean>((resolve) => {
          finishConfirmation = resolve;
          options?.signal?.addEventListener("abort", () => resolve(false), { once: true });
          ready();
        });
      };
      let committed = false;
      const running = runCancellableOperation(
        ctx,
        "History",
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
              onCommit: () => {
                committed = true;
                onCommit?.();
              },
            },
            () => backend,
          );
          return { kind: "completed" };
        },
        {
          cancelAcrossDialogs: true,
          commitAware: true,
          signal: owner.signal,
          cancelledMessage: "History review cancelled; no files were changed.",
        },
      );
      try {
        await confirmationOpened;
        assert.ok(confirmationSignal);
        assert.equal(confirmationSignal.aborted, false);
        if (end === "reject") finishConfirmation(false);
        else if (end === "cancel") {
          const listener = [...listeners][0];
          assert.ok(listener);
          assert.deepEqual(listener("\u0003"), { consume: true });
        } else if (end === "dispose") tui.dispose();
        else if (end.startsWith("stale-owner")) {
          Object.assign(ctx, { sessionManager: { ...ctx.sessionManager, getSessionId: () => "replaced-session" } });
          finishConfirmation(end === "stale-owner-accept");
        } else owner.abort(new DOMException(end, "AbortError"));

        if (end.startsWith("stale-owner")) await assert.rejects(running, /Session changed during file mutation/u);
        else
          assert.deepEqual(await running, {
            kind: end === "reject" ? "completed" : end === "cancel" ? "cancelled" : "closed",
          });
        assert.equal(committed, false);
        assert.equal(confirmationSignal.aborted, true);
        assert.deepEqual(
          context.notifications.map((item) => item.message),
          end === "reject"
            ? ["Rollback cancelled."]
            : end === "cancel"
              ? ["History review cancelled; no files were changed."]
              : [],
        );
        assert.equal(readFileSync(file, "utf8"), '{"local":true}\n');
        assert.deepEqual(await backend.readHead(), before);
        assert.equal(listeners.size, 0);
      } finally {
        owner.abort();
        tui.dispose();
        finishConfirmation?.(false);
        await running.catch(() => undefined);
      }
    });
  });
}
