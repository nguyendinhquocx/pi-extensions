import assert from "node:assert/strict";
import { test } from "vitest";
import {
  createGoalContextContract,
  createInactiveGoalContextContract,
  reconcileGoalContextContract,
  reconcileInactiveGoalContextContract,
} from "../src/goal-contract.js";
import type { GoalPromptContext } from "../src/prompts.js";

const goal: GoalPromptContext = {
  id: "restored-goal",
  text: "Finish the retained work",
  status: "active",
  iteration: 1,
  tokensUsed: 0,
  startedAt: 0,
  updatedAt: 0,
  timeUsedSeconds: 0,
  baselineTokens: 0,
};

const states = [
  {
    name: "active",
    expected: createGoalContextContract(goal),
    reconcile: (messages: unknown[]) => reconcileGoalContextContract(messages, goal),
  },
  {
    name: "inactive",
    expected: createInactiveGoalContextContract(),
    reconcile: reconcileInactiveGoalContextContract,
  },
];

const summaries = [[], ["compactionSummary"], ["branchSummary"], ["compactionSummary", "branchSummary"]];

for (const state of states) {
  for (const roles of summaries) {
    for (const withSystem of [false, true]) {
      test(`${state.name} restoration appends after ${roles.join(" + ") || "ordinary history"}, system=${withSystem}`, () => {
        const messages = [
          ...(withSystem ? [{ role: "system", content: "Stable instructions" }] : []),
          ...roles.map((role) => ({ role, content: `${role} retained text` })),
          { role: "user", content: "Retained request" },
          { role: "assistant", content: [{ type: "text", text: "Retained response" }] },
        ];
        const original = structuredClone(messages);
        const restored = state.reconcile(messages);
        assert.deepEqual(restored, [...original, state.expected]);
        assert.deepEqual(messages, original);
        assert.deepEqual(state.reconcile(restored), restored);

        // Pi publishes the same content with runtime metadata at the transcript tail.
        const persisted = [...messages, { ...state.expected, timestamp: 123 }];
        assert.deepEqual(state.reconcile(persisted), persisted);
      });
    }
  }

  test(`${state.name} restoration appends to empty context`, () => {
    assert.deepEqual(state.reconcile([]), [state.expected]);
  });
}

test("only the latest contract controls active and inactive supersession", () => {
  const active = createGoalContextContract(goal);
  const inactive = createInactiveGoalContextContract();
  const changedGoal = { ...goal, id: "replacement-goal", text: "Finish the replacement work" };
  const replacement = createGoalContextContract(changedGoal);
  const history = [active, { role: "user", content: "Stop" }, inactive];

  const reactivated = reconcileGoalContextContract(history, goal);
  assert.deepEqual(reactivated, [...history, active]);
  assert.deepEqual(reconcileGoalContextContract(reactivated, goal), reactivated);
  const replaced = reconcileGoalContextContract(reactivated, changedGoal);
  assert.deepEqual(replaced, [...reactivated, replacement]);
  assert.deepEqual(reconcileGoalContextContract(replaced, changedGoal), replaced);
  const stopped = reconcileInactiveGoalContextContract(replaced);
  assert.deepEqual(stopped, [...replaced, inactive]);
  assert.deepEqual(reconcileInactiveGoalContextContract(stopped), stopped);
});

for (const state of states) {
  test(`${state.name} contract delivered after a later turn is placed where it was sent`, () => {
    const retained = [
      { role: "compactionSummary", content: "Compacted work", timestamp: 1_000 },
      { role: "toolResult", content: [{ type: "text", text: "Retained result" }], timestamp: 1_100 },
    ];
    const restored = state.reconcile(retained);
    // Pi defers a contract sent mid-run until the next turn ends, after newer output.
    const laterTurn = [
      { role: "assistant", content: [{ type: "text", text: "Next turn" }], timestamp: 2_100 },
      { role: "toolResult", content: [{ type: "text", text: "Next result" }], timestamp: 2_200 },
    ];
    const delivered = { ...state.expected, details: { ...state.expected.details, sentAt: 2_000 }, timestamp: 2_300 };
    const next = state.reconcile([...retained, ...laterTurn, delivered]);
    // The placed copy carries its send time, so timestamps stay ordered for Pi's usage estimate.
    assert.deepEqual(next, [...retained, { ...delivered, timestamp: 2_000 }, ...laterTurn]);
    assert.deepEqual(
      next.map((message) => (message as { content: unknown }).content),
      [...restored, ...laterTurn].map((message) => (message as { content: unknown }).content),
    );
  });
}

const call = { role: "assistant", content: [{ type: "toolCall", id: "call-1", name: "bash", arguments: {} }] };
const result = { role: "toolResult", toolCallId: "call-1", content: [{ type: "text", text: "Tool output" }] };
const sentDuring = {
  ...createGoalContextContract(goal),
  details: { version: 2, state: "active", goalId: goal.id, sentAt: 2_000 },
};
const unplaced = [
  {
    name: "a contract sent during a turn stays after that turn's tool result",
    messages: [
      { ...call, timestamp: 1_900 },
      { ...result, timestamp: 2_100 },
      { ...sentDuring, timestamp: 2_200 },
    ],
  },
  {
    name: "a contract without sentAt stays where Pi persisted it",
    messages: [
      { ...call, timestamp: 2_100 },
      { ...result, timestamp: 2_200 },
      { ...createGoalContextContract(goal), timestamp: 2_300 },
    ],
  },
  {
    name: "a message without a timestamp ends the search for a boundary",
    messages: [{ ...call }, { ...result, timestamp: 2_200 }, { ...sentDuring, timestamp: 2_300 }],
  },
];

for (const { name, messages } of unplaced) {
  test(name, () => {
    assert.deepEqual(reconcileGoalContextContract(messages, goal), messages);
  });
}

test("a deferred contract is never placed before an earlier contract", () => {
  const earlier = { ...createInactiveGoalContextContract(), timestamp: 2_050 };
  const turn = [
    { ...call, timestamp: 2_100 },
    { ...result, timestamp: 2_200 },
  ];
  const deferred = { ...sentDuring, timestamp: 2_300 };
  assert.deepEqual(reconcileGoalContextContract([earlier, ...turn, deferred], goal), [
    earlier,
    { ...deferred, timestamp: 2_000 },
    ...turn,
  ]);
});
