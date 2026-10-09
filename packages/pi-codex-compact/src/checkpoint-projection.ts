import type { AgentMessage } from "@earendil-works/pi-agent-core";
import {
  buildContextEntries,
  buildSessionProjection,
  type SessionEntry,
  sessionEntryToContextMessages,
} from "@earendil-works/pi-coding-agent";
import { fingerprintMessage, type latestCheckpoint, projectCheckpointContext } from "./checkpoint.js";

/** Use the same finalized projection as Pi, including edits and suppressed older summaries. */
export function projectedKeptMessages(
  entries: SessionEntry[],
  leafId: string | null,
  firstKeptEntryId: string,
): AgentMessage[] {
  const projection = buildSessionProjection(entries, leafId);
  const index = projection.entries.findIndex(({ sourceEntry }) => sourceEntry.id === firstKeptEntryId);
  if (index < 0) throw new Error("Pi compaction cut point is not present in the active context");
  // A newly appended compaction suppresses all retained compaction entries and
  // folds pre-compaction system messages into its own system checkpoint.
  return projection.entries
    .slice(index)
    .flatMap(({ sourceEntry, messages }) =>
      sourceEntry.type === "compaction" ? [] : messages.filter((message) => message.role !== "system"),
    );
}

export function projectSessionCheckpointContext(
  messages: readonly AgentMessage[],
  entries: SessionEntry[],
  checkpoint: NonNullable<ReturnType<typeof latestCheckpoint>>,
): AgentMessage[] | undefined {
  const { entry, details } = checkpoint;
  // Reconstruct only the snapshot that the provider actually compacted. Later edits
  // must still fail the ordinary prefix check rather than be silently absorbed.
  if (entry.parentId !== null && !entries.some((candidate) => candidate.id === entry.parentId)) return undefined;
  let canonical: AgentMessage[];
  try {
    canonical =
      entry.firstKeptEntryId === entry.id ? [] : projectedKeptMessages(entries, entry.parentId, entry.firstKeptEntryId);
  } catch {
    return undefined;
  }
  const fingerprints = canonical.map(fingerprintMessage);
  const matches = (expected: readonly string[]) =>
    expected.length === details.keptMessageFingerprints.length &&
    expected.every((fingerprint, index) => fingerprint === details.keptMessageFingerprints[index]);
  if (!matches(fingerprints)) {
    // Older releases fingerprinted raw entries, including omitted messages and
    // nested summaries. Accept that contract only after verifying the entire raw
    // snapshot; never relax the fingerprint check against arbitrary current text.
    const raw = buildContextEntries(entries, entry.parentId);
    const index = raw.findIndex((candidate) => candidate.id === entry.firstKeptEntryId);
    if (index < 0 || !matches(raw.slice(index).flatMap(sessionEntryToContextMessages).map(fingerprintMessage)))
      return undefined;
  }
  return projectCheckpointContext(messages, { ...details, keptMessageFingerprints: fingerprints }, entry.summary);
}
