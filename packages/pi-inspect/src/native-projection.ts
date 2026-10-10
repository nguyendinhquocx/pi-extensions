import { buildContextEntries, buildSessionProjection, type SessionEntry } from "@earendil-works/pi-coding-agent";
import { identityIssue } from "./identity.js";

// Parent/role structure has already been validated. Native selection drops old
// summaries/checkpoints and applies edits before content-envelope validation.
export function nativeProjection(path: SessionEntry[], leaf: string | null) {
  const contextEntries = buildContextEntries(path, leaf);
  if (contextEntries[0]?.type === "compaction") {
    const issue = identityIssue(contextEntries[0]);
    if (issue) return { issue };
  }
  const edits = new Map(
    contextEntries.filter((entry) => entry.type === "context_edit").map((entry) => [entry.targetId, entry]),
  );
  for (const entry of edits.values()) {
    if (entry.type === "context_edit") {
      const issue = identityIssue(entry);
      if (issue) return { issue };
    }
  }
  const projection = buildSessionProjection(path, leaf);
  for (const projected of projection.entries)
    for (const message of projected.messages) {
      const issue = identityIssue({ ...projected.sourceEntry, type: "message", message } as SessionEntry);
      if (issue) return { issue };
    }
  return { projection };
}
