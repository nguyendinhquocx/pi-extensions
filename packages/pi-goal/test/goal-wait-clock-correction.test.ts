import assert from "node:assert/strict";
import { afterEach, beforeEach, test, vi } from "vitest";
import { createMockContext } from "../../../test/support.js";
import { MIN_GOAL_WAIT_DELAY_MS } from "../src/wait.js";
import { requireGoalTool, requireLastGoal, startGoalForTest } from "./support/goal-fixture.js";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-08-10T00:00:00.000Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

async function startWaiting(contextOverrides: Parameters<typeof startGoalForTest>[0] = {}) {
  const waiting = await startGoalForTest(contextOverrides);
  const goal = requireLastGoal(waiting.mock);
  await requireGoalTool(waiting.mock, "goal_wait").execute(
    "wait-clock",
    { goal_id: goal.id, reason: "Waiting across a clock correction", resume_after_ms: MIN_GOAL_WAIT_DELAY_MS },
    new AbortController().signal,
    () => undefined,
    waiting.ctx,
  );
  await waiting.mock.events.get("agent_end")?.[0]?.(
    { messages: [{ role: "assistant", stopReason: "toolUse" }] },
    waiting.ctx,
  );
  await waiting.mock.events.get("agent_settled")?.[0]?.({}, waiting.ctx);
  return waiting;
}

test("a backward clock correction wakes the goal exactly once at its absolute deadline", async () => {
  const waiting = await startWaiting();
  const resumeAt = requireLastGoal(waiting.mock).waiting?.resumeAt;
  vi.setSystemTime(Date.now() - 100);
  await vi.advanceTimersByTimeAsync(MIN_GOAL_WAIT_DELAY_MS);
  assert.equal(waiting.mock.sentUserMessages.length, 1);
  assert.equal(requireLastGoal(waiting.mock).waiting?.resumeAt, resumeAt);
  assert.equal(vi.getTimerCount(), 1);
  await vi.advanceTimersByTimeAsync(99);
  assert.equal(waiting.mock.sentUserMessages.length, 1);
  await vi.advanceTimersByTimeAsync(1);
  assert.equal(Date.now(), resumeAt);
  assert.equal(waiting.mock.sentUserMessages.length, 2);
  assert.equal(requireLastGoal(waiting.mock).waiting, undefined);
  await waiting.mock.events.get("agent_settled")?.[0]?.({}, waiting.ctx);
  await vi.runOnlyPendingTimersAsync();
  assert.equal(waiting.mock.sentUserMessages.length, 2);
});

test.each([false, true])("a corrected retry preserves bounded delivery (retry fails: %s)", async (retryFails) => {
  const waiting = await startWaiting();
  const sendUserMessage = waiting.mock.rawPi.sendUserMessage.bind(waiting.mock.rawPi);
  let attempts = 0;
  waiting.mock.rawPi.sendUserMessage = (...args) => {
    attempts += 1;
    if (attempts === 1 || retryFails) throw new Error("deadline delivery failed");
    sendUserMessage(...args);
  };
  await vi.advanceTimersByTimeAsync(MIN_GOAL_WAIT_DELAY_MS);
  assert.equal(attempts, 1);
  assert.ok(requireLastGoal(waiting.mock).waiting);
  vi.setSystemTime(Date.now() - 100);
  await vi.advanceTimersByTimeAsync(1_000);
  assert.equal(attempts, 1);
  assert.equal(vi.getTimerCount(), 1);
  await vi.advanceTimersByTimeAsync(100);
  assert.equal(attempts, 2);
  assert.equal(waiting.mock.sentUserMessages.length, retryFails ? 1 : 2);
  assert.equal(Boolean(requireLastGoal(waiting.mock).waiting), retryFails);
  await vi.advanceTimersByTimeAsync(10_000);
  await waiting.mock.events.get("agent_settled")?.[0]?.({}, waiting.ctx);
  assert.equal(attempts, 2);
});

test.each(["busy", "pending"] as const)("a corrected deadline preserves the %s gate", async (gate) => {
  let gated = false;
  const waiting = await startWaiting({
    isIdle: () => gate !== "busy" || !gated,
    hasPendingMessages: () => gate === "pending" && gated,
  });
  gated = true;
  vi.setSystemTime(Date.now() - 100);
  await vi.advanceTimersByTimeAsync(MIN_GOAL_WAIT_DELAY_MS + 100);
  assert.equal(waiting.mock.sentUserMessages.length, 1);
  assert.ok(requireLastGoal(waiting.mock).waiting);
  gated = false;
  await waiting.mock.events.get("agent_settled")?.[0]?.({}, waiting.ctx);
  assert.equal(waiting.mock.sentUserMessages.length, 2);
  assert.equal(requireLastGoal(waiting.mock).waiting, undefined);
});

test.each(["shutdown", "session replacement", "pause", "clear", "goal replacement", "external input"] as const)(
  "%s cancels a re-armed Goal deadline",
  async (action) => {
    const waiting = await startWaiting();
    vi.setSystemTime(Date.now() - 100);
    await vi.advanceTimersByTimeAsync(MIN_GOAL_WAIT_DELAY_MS);
    assert.equal(vi.getTimerCount(), 1);
    if (action === "shutdown" || action === "session replacement") {
      await waiting.mock.events.get("session_shutdown")?.[0]?.({}, waiting.ctx);
      assert.ok(requireLastGoal(waiting.mock).waiting);
      if (action === "session replacement") {
        const replacement = createMockContext();
        await waiting.mock.events.get("session_start")?.[0]?.({}, replacement.ctx);
      }
    } else if (action === "external input") {
      waiting.mock.events.get("input")?.[0]?.({ source: "rpc", text: "External wake" }, waiting.ctx);
    } else {
      await waiting.mock.commands
        .get("goal")
        ?.handler(action === "goal replacement" ? "replacement objective" : action, waiting.ctx);
    }
    assert.equal(vi.getTimerCount(), 0);
    const messagesAfterAction = waiting.mock.sentUserMessages.length;
    await vi.advanceTimersByTimeAsync(100);
    assert.equal(waiting.mock.sentUserMessages.length, messagesAfterAction);
  },
);
