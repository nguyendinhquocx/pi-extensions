import assert from "node:assert/strict";
import { test } from "vitest";
import { createHarness } from "./progress-harness.js";

test("drops reason from non-blocked progress steps before strict validation", () => {
  const { tool } = createHarness();

  assert.deepEqual(
    tool.prepareArguments({
      steps: [
        { text: "queued", status: "pending", reason: "not started yet" },
        { text: "working", status: "in_progress", reason: "checking the implementation" },
        { text: "done", status: "completed", reason: "verified" },
        { text: "waiting", status: "blocked", reason: "needs approval" },
      ],
    }),
    {
      steps: [
        { text: "queued", status: "pending" },
        { text: "working", status: "in_progress" },
        { text: "done", status: "completed" },
        { text: "waiting — needs approval", status: "blocked" },
      ],
    },
  );
});

test("blocked steps no longer require reason", () => {
  const { tool } = createHarness();

  assert.deepEqual(tool.prepareArguments({ steps: [{ text: "waiting for approval", status: "blocked" }] }), {
    steps: [{ text: "waiting for approval", status: "blocked" }],
  });
});
