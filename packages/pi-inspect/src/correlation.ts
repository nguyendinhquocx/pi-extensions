import type { Call } from "./model.js";

// Occurrence IDs form the captured execution graph. Raw IDs are only used with an owning assistant anchor.
export function correlatedCalls(rawIds: Set<string>, anchor: string | undefined, all: Call[]): Call[] {
  if (!anchor) return [];
  const multiplicity = new Map<string, number>();
  for (const call of all)
    if (call.branchAnchor === anchor) multiplicity.set(call.id, (multiplicity.get(call.id) ?? 0) + 1);
  const ids = new Set(
    all
      .filter(
        (call) =>
          (rawIds.has(call.id) ||
            (call.parentId !== undefined &&
              rawIds.has(call.parentId) &&
              (!call.parentOccurrenceId || !all.some((parent) => parent.occurrenceId === call.parentOccurrenceId)))) &&
          call.branchAnchor === anchor &&
          (!call.parentOccurrenceId || !all.some((parent) => parent.occurrenceId === call.parentOccurrenceId)) &&
          !call.correlationUnavailable &&
          (multiplicity.get(call.id) ?? 0) < 2,
      )
      .map((call) => call.occurrenceId),
  );
  for (let i = 0; i < all.length; i++)
    for (const call of all) if (call.parentOccurrenceId && ids.has(call.parentOccurrenceId)) ids.add(call.occurrenceId);
  return all.filter((call) => ids.has(call.occurrenceId));
}
