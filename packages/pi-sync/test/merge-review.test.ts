import assert from "node:assert/strict";
import { test } from "vitest";
import { createCustomSelectorHarness, createMockContext } from "../../../test/support.js";
import { confirmMergeReview } from "../src/ui/merge-review.js";

for (const [key, confirmed] of [
  ["l", true],
  ["q", false],
  ["\u0003", false],
] as const) {
  test(`merged TUI review uses remapped actions and hard cancellation ${JSON.stringify(key)}`, async () => {
    const bindings: Record<string, string> = {
      "tui.select.confirm": "l",
      "tui.select.cancel": "q",
      "tui.select.up": "k",
      "tui.select.down": "j",
    };
    let frame: string[] = [];
    let constructionError: unknown;
    const context = createMockContext({
      mode: "tui",
      custom: async (factory: unknown) => {
        try {
          type Component = { render(width: number): string[]; handleInput(data: string): void };
          let resolve!: (component: Component) => void;
          let reject!: (error: unknown) => void;
          const ready = new Promise<Component>((success, failure) => {
            resolve = success;
            reject = failure;
          });
          const harness = createCustomSelectorHarness(
            (...args: unknown[]) => {
              Promise.resolve((factory as (...args: unknown[]) => unknown)(...args)).then(
                (value) => resolve(value as Component),
                reject,
              );
              return { render: () => [], handleInput() {} };
            },
            40,
            {
              matches: (data, action) => data === bindings[action],
              getKeys: (action) => (bindings[action] ? [bindings[action]] : []),
            },
            16,
          );
          const component = await ready;
          frame = component.render(40);
          component.handleInput(key);
          return harness.resultPromise;
        } catch (error) {
          constructionError = error;
          throw error;
        }
      },
    });
    assert.equal(
      await confirmMergeReview(
        context.ctx,
        "Merge?",
        "  exact spaces\nlocal replaces and deletions\nremote replaces and deletions",
        undefined,
        () => true,
      ).catch((error) => {
        throw constructionError ?? error;
      }),
      confirmed,
    );
    assert.ok(frame.some((line) => line.includes("  exact spaces")));
    assert.ok(frame.some((line) => line.includes("Apply merged transfer")));
    assert.ok(frame.every((line) => line.length <= 40));
  });
}

test("merged RPC review exposes paginated exact changes without custom TUI", async () => {
  const pages: string[] = [];
  let customCalls = 0;
  const context = createMockContext({
    mode: "rpc",
    custom: async () => {
      customCalls++;
    },
    select: async (title: string, choices: string[]) => {
      pages.push(title);
      return choices.includes("Next") ? "Next" : "Apply merged transfer";
    },
  });
  assert.equal(
    await confirmMergeReview(
      context.ctx,
      "Merge?",
      Array.from({ length: 30 }, (_, index) => `change ${index}`).join("\n"),
      undefined,
      () => true,
    ),
    true,
  );
  assert.equal(customCalls, 0);
  assert.ok(pages.length > 1);
  assert.match(pages.join("\n"), /change 0/);
  assert.match(pages.join("\n"), /change 29/);
});

test("replaced review owner cannot authorize a transfer", async () => {
  let current = true;
  const context = createMockContext({
    mode: "rpc",
    select: async () => {
      current = false;
      return "Apply merged transfer";
    },
  });
  assert.equal(await confirmMergeReview(context.ctx, "Merge?", "changes", undefined, () => current), false);
});
