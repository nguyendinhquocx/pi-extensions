import assert from "node:assert/strict";
import { initTheme, type TerminalInputHandler } from "@earendil-works/pi-coding-agent";
import { isKittyProtocolActive, type KeyId, matchesKey, setKittyProtocolActive } from "@earendil-works/pi-tui";
import { createTuiHarness } from "@narumitw/pi-tui-kit/testing";
import { test } from "vitest";
import { createMockContext } from "../../../test/support.js";
import { runCancellableOperation } from "../src/ui/cancellable-operation.js";

initTheme("dark", false);

// Cover each release family recognized by Pi, plus printable/remapped keys,
// modifier order, confirm/cancel collision, and the independent hard-cancel path.
const bindings: { name: string; key: KeyId; sequence: string; legacy: string }[] = [
  { name: "printable q", key: "q", sequence: "113;1", legacy: "q" },
  { name: "Enter confirmation collision", key: "enter", sequence: "13;1", legacy: "\r" },
  { name: "Escape", key: "escape", sequence: "27;1", legacy: "\u001b" },
  { name: "hard Ctrl+C", key: "ctrl+c", sequence: "99;5", legacy: "\u0003" },
  { name: "modifier order", key: "shift+ctrl+q", sequence: "113;6", legacy: "\u001b[113;6u" },
  { name: "alternate printable keys", key: "shift+q", sequence: "113:81:113;2", legacy: "Q" },
  { name: "Up", key: "up", sequence: "1;1", legacy: "\u001b[A" },
  { name: "Down", key: "down", sequence: "1;1", legacy: "\u001b[B" },
  { name: "Right", key: "right", sequence: "1;1", legacy: "\u001b[C" },
  { name: "Left", key: "left", sequence: "1;1", legacy: "\u001b[D" },
  { name: "Home", key: "home", sequence: "1;1", legacy: "\u001b[H" },
  { name: "End", key: "end", sequence: "1;1", legacy: "\u001b[F" },
  { name: "tilde functional key", key: "insert", sequence: "2;1", legacy: "\u001b[2~" },
];
const suffix = (name: string) =>
  (
    ({ Up: "A", Down: "B", Right: "C", Left: "D", Home: "H", End: "F", "tilde functional key": "~" }) as Record<
      string,
      string
    >
  )[name] ?? "u";

for (const kitty of [false, true]) {
  for (const committed of [false, true]) {
    for (const binding of bindings) {
      test(`History ignores ${binding.name} releases (Kitty=${kitty}, committed=${committed})`, async () => {
        const previousMode = isKittyProtocolActive();
        setKittyProtocolActive(kitty);
        const terminalListeners = new Set<TerminalInputHandler>();
        const tui = createTuiHarness({
          keybindings: {
            matches: (data, action) =>
              action === "tui.select.cancel" && binding.key !== "ctrl+c" && matchesKey(data, binding.key),
            getKeys: (action) =>
              action === "tui.select.cancel" ? [binding.key === "ctrl+c" ? "escape" : binding.key] : [],
          },
        });
        const { ctx, notifications } = createMockContext({
          mode: "tui",
          custom: tui.custom,
          onTerminalInput(handler: TerminalInputHandler) {
            terminalListeners.add(handler);
            return () => {
              terminalListeners.delete(handler);
            };
          },
        });
        let signal: AbortSignal | undefined;
        let release!: () => void;
        const gate = new Promise<void>((resolve) => {
          release = resolve;
        });
        const running = runCancellableOperation(
          ctx,
          "History",
          "history",
          async (_route, operationSignal, onCommit) => {
            signal = operationSignal;
            if (committed) onCommit?.();
            await gate;
            return { kind: "completed" };
          },
          { cancelAcrossDialogs: true, commitAware: true },
        );
        const dispatch = (data: string) => {
          for (const listener of terminalListeners) if (listener(data)?.consume) return true;
          return false;
        };
        const event = (type: number) => `\u001b[${binding.sequence}:${type}${suffix(binding.name)}`;
        try {
          await tui.waitForOpen();
          // Matchers alone accept release packets; our listener must reject them
          // before matching or publishing a post-commit cancellation warning.
          assert.equal(matchesKey(event(3), binding.key), true);
          assert.equal(dispatch(event(3)), false);
          assert.equal(signal?.aborted, false);
          assert.deepEqual(notifications, []);
          assert.equal(dispatch(`\u001b[200~${event(3)}\u001b[201~`), false);
          assert.equal(dispatch("z"), false);
          if (committed) {
            for (const input of [event(1), event(2), binding.legacy]) {
              assert.equal(dispatch(input), true);
              assert.equal(signal?.aborted, false);
            }
            assert.equal(notifications.length, 3);
            release();
            assert.deepEqual(await running, { kind: "completed" });
          } else {
            assert.equal(dispatch(event(1)), true);
            assert.equal(signal?.aborted, true);
            release();
            assert.deepEqual(await running, { kind: "cancelled" });
          }
          assert.equal(terminalListeners.size, 0);
        } finally {
          release();
          tui.dispose();
          await running;
          setKittyProtocolActive(previousMode);
        }
      });
    }
  }
}
