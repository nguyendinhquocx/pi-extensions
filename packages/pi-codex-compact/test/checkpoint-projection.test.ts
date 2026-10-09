import assert from "node:assert/strict";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import {
  buildContextEntries,
  buildSessionContext,
  type SessionEntry,
  sessionEntryToContextMessages,
} from "@earendil-works/pi-coding-agent";
import { test } from "vitest";
import {
  createCheckpointDetails,
  fallbackSummary,
  latestCheckpoint,
  projectCheckpointContext,
} from "../src/checkpoint.js";
import { projectedKeptMessages, projectSessionCheckpointContext } from "../src/checkpoint-projection.js";

function user(id: string, time: number): SessionEntry {
  return {
    type: "message",
    id,
    parentId: null,
    timestamp: new Date(time).toISOString(),
    message: { role: "user", content: id, timestamp: time },
  };
}
function chain(entries: SessionEntry[]): SessionEntry[] {
  return entries.map((entry, index) => ({ ...entry, parentId: index ? entries[index - 1].id : null }));
}
function compact(id: string, kept: AgentMessage[], firstKeptEntryId = "first"): SessionEntry {
  const details = createCheckpointDetails({
    provider: "openai-codex",
    api: "openai-codex-responses",
    profile: "codex-responses-v1",
    modelId: "fixture-model",
    protocol: "remote-v2",
    replacementHistory: [{ type: "compaction", encrypted_content: "synthetic-opaque" }],
    keptMessages: kept,
    checkpointId: `checkpoint-${id}`,
  });
  return {
    type: "compaction",
    id,
    parentId: null,
    timestamp: new Date(100).toISOString(),
    summary: fallbackSummary(details.checkpointId),
    firstKeptEntryId,
    tokensBefore: 100,
    details,
  };
}
function edit(id: string, targetId: string, replacement: { content: string } | null): SessionEntry {
  return { type: "context_edit", id, parentId: null, timestamp: new Date(50).toISOString(), targetId, replacement };
}

for (const legacy of [true, false]) {
  for (const replacement of [null, { content: "edited before compaction" }]) {
    test(`projects ${legacy ? "legacy raw" : "canonical"} checkpoint with preexisting ${replacement ? "replacement" : "omission"}`, () => {
      const before = chain([user("first", 1), user("second", 2), edit("edit", "first", replacement)]);
      const kept = legacy
        ? buildContextEntries(before, "edit").flatMap(sessionEntryToContextMessages)
        : projectedKeptMessages(before, "edit", "first");
      const entries = chain([...before, compact("active", kept), user("later", 200)]);
      const checkpoint = latestCheckpoint(entries);
      assert.ok(checkpoint);
      const messages = buildSessionContext(entries).messages;
      if (legacy)
        assert.equal(projectCheckpointContext(messages, checkpoint.details, checkpoint.entry.summary), undefined);
      const projected = projectSessionCheckpointContext(messages, entries, checkpoint);
      assert.ok(projected);
      assert.equal(projected.length, 2);
      const lastEntry = entries.at(-1);
      assert.ok(lastEntry);
      assert.deepEqual(projected[1], sessionEntryToContextMessages(lastEntry)[0]);
      // An ordinary appended turn preserves the exact model-visible prefix.
      const next = chain([...entries, user("next", 201)]);
      assert.deepEqual(
        projectSessionCheckpointContext(buildSessionContext(next).messages, next, checkpoint)?.slice(0, 2),
        projected,
      );
      assert.equal(projectSessionCheckpointContext(projected, entries, checkpoint), undefined);
    });
  }
}

test("verifies nested legacy checkpoints when older summaries disappear from Pi context", () => {
  const first = user("first", 1);
  const initial = chain([first, compact("older", sessionEntryToContextMessages(first)), user("second", 2)]);
  const before = chain([
    ...initial,
    compact("middle", projectedKeptMessages(initial, "second", "first")),
    user("third", 3),
  ]);
  const raw = buildContextEntries(before, "third");
  const index = raw.findIndex((entry) => entry.id === "first");
  const entries = chain([
    ...before,
    compact("active", raw.slice(index).flatMap(sessionEntryToContextMessages)),
    user("later", 200),
  ]);
  const checkpoint = latestCheckpoint(entries);
  assert.ok(checkpoint);
  const messages = buildSessionContext(entries).messages;
  assert.equal(projectCheckpointContext(messages, checkpoint.details, checkpoint.entry.summary), undefined);
  assert.equal(projectSessionCheckpointContext(messages, entries, checkpoint)?.length, 2);
  assert.deepEqual(
    projectedKeptMessages(entries, "later", "first").map((message) => message.role),
    ["user", "user", "user", "user"],
  );
});

test("does not guess missing snapshots, mutated retained content, or post-checkpoint edits", () => {
  const first = user("first", 1);
  const entries = chain([first, compact("active", sessionEntryToContextMessages(first)), user("later", 200)]);
  const checkpoint = latestCheckpoint(entries);
  assert.ok(checkpoint);
  for (const replacement of [null, { content: "edited after compaction" }]) {
    const edited = chain([...entries, edit("late-edit", "first", replacement)]);
    assert.equal(projectSessionCheckpointContext(buildSessionContext(edited).messages, edited, checkpoint), undefined);
  }
  assert.equal(
    projectSessionCheckpointContext(buildSessionContext(entries).messages, entries.slice(1), checkpoint),
    undefined,
  );
  const mutated = chain([user("mutated", 1), ...entries.slice(1)]);
  assert.equal(projectSessionCheckpointContext(buildSessionContext(entries).messages, mutated, checkpoint), undefined);
});
