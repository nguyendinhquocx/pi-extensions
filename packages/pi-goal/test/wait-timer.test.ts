import assert from "node:assert/strict";
import { afterEach, beforeEach, test, vi } from "vitest";
import { GoalWaitTimer, MAX_GOAL_WAIT_DELAY_MS } from "../src/wait.js";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-08-10T00:00:00.000Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

test.each([31, 99, 100])("a %i ms backward correction preserves the absolute deadline", async (correction) => {
  const timer = new GoalWaitTimer();
  const onDue = vi.fn();
  const resumeAt = Date.now() + 10_000;
  timer.schedule(resumeAt, onDue);
  vi.setSystemTime(Date.now() - correction);

  await vi.advanceTimersByTimeAsync(10_000);
  assert.equal(onDue.mock.calls.length, 0);
  assert.equal(vi.getTimerCount(), 1);
  await vi.advanceTimersByTimeAsync(correction - 1);
  assert.equal(onDue.mock.calls.length, 0);
  await vi.advanceTimersByTimeAsync(1);
  assert.equal(Date.now(), resumeAt);
  assert.equal(onDue.mock.calls.length, 1);
  assert.equal(vi.getTimerCount(), 0);
});

test("repeated backward corrections re-arm against the original deadline", async () => {
  const timer = new GoalWaitTimer();
  const onDue = vi.fn();
  const resumeAt = Date.now() + 10_000;
  timer.schedule(resumeAt, onDue);
  vi.setSystemTime(Date.now() - 100);
  await vi.advanceTimersByTimeAsync(10_000);
  vi.setSystemTime(Date.now() - 50);
  await vi.advanceTimersByTimeAsync(100);
  assert.equal(onDue.mock.calls.length, 0);
  assert.equal(vi.getTimerCount(), 1);
  await vi.advanceTimersByTimeAsync(50);
  assert.equal(Date.now(), resumeAt);
  assert.equal(onDue.mock.calls.length, 1);
  assert.equal(vi.getTimerCount(), 0);
});

test.each(["clear", "replace"] as const)("%s cancels a re-armed timer", async (action) => {
  const timer = new GoalWaitTimer();
  const oldDue = vi.fn();
  const newDue = vi.fn();
  timer.schedule(Date.now() + 10_000, oldDue);
  vi.setSystemTime(Date.now() - 100);
  await vi.advanceTimersByTimeAsync(10_000);
  assert.equal(oldDue.mock.calls.length, 0);
  assert.equal(vi.getTimerCount(), 1);

  if (action === "clear") {
    timer.clear();
    timer.clear();
    assert.equal(vi.getTimerCount(), 0);
  } else {
    timer.schedule(Date.now() + 200, newDue);
    assert.equal(vi.getTimerCount(), 1);
  }
  await vi.advanceTimersByTimeAsync(100);
  assert.equal(oldDue.mock.calls.length, 0);
  assert.equal(newDue.mock.calls.length, 0);
  await vi.advanceTimersByTimeAsync(100);
  assert.equal(oldDue.mock.calls.length, 0);
  assert.equal(newDue.mock.calls.length, action === "replace" ? 1 : 0);
  assert.equal(vi.getTimerCount(), 0);
});

test.each([-100, 0, 100])("a deadline offset by %i ms dispatches once", async (offset) => {
  const timer = new GoalWaitTimer();
  const onDue = vi.fn();
  timer.schedule(Date.now() + offset, onDue);
  await vi.advanceTimersByTimeAsync(Math.max(1, offset));
  assert.equal(onDue.mock.calls.length, 1);
  assert.equal(vi.getTimerCount(), 0);
});

test("a deadline beyond Node's maximum timer delay waits for the remaining interval", async () => {
  const timer = new GoalWaitTimer();
  const onDue = vi.fn();
  const resumeAt = Date.now() + MAX_GOAL_WAIT_DELAY_MS + 100;
  timer.schedule(resumeAt, onDue);
  await vi.advanceTimersByTimeAsync(MAX_GOAL_WAIT_DELAY_MS);
  assert.equal(onDue.mock.calls.length, 0);
  assert.equal(vi.getTimerCount(), 1);
  await vi.advanceTimersByTimeAsync(99);
  assert.equal(onDue.mock.calls.length, 0);
  await vi.advanceTimersByTimeAsync(1);
  assert.equal(Date.now(), resumeAt);
  assert.equal(onDue.mock.calls.length, 1);
  assert.equal(vi.getTimerCount(), 0);
});
