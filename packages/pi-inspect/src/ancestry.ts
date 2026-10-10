import type { ExtensionContext, SessionEntry } from "@earendil-works/pi-coding-agent";

import { EntryIndex } from "./entry-index.js";
import { structuralIssue } from "./identity.js";
import { nativeProjection } from "./native-projection.js";

// Pi's native projection walks parent links without cycle detection; validate before invoking it.
export function ancestry(
  manager: ExtensionContext["sessionManager"],
  id: string,
  index = new EntryIndex(manager.getEntries()),
): { path: SessionEntry[]; issue?: string } {
  const path: SessionEntry[] = [];
  const seen = new Set<string>();
  if (index.duplicates.has(id)) return { path: [], issue: "duplicate entry id" };
  let current = index.get(id);
  while (current) {
    const issue = structuralIssue(current);
    if (issue) return { path: path.reverse(), issue };
    if (seen.has(current.id)) return { path: path.reverse(), issue: "recorded parent cycle" };
    if (path.length >= 10000)
      return { path: path.reverse(), issue: "ancestry exceeds the 10,000-entry inspection budget" };
    seen.add(current.id);
    path.push(current);
    const parent = current.parentId;
    if (parent && index.duplicates.has(parent)) return { path: path.reverse(), issue: "duplicate ancestor id" };
    current = parent ? index.get(parent) : undefined;
    if (parent && !current) return { path: path.reverse(), issue: "missing recorded parent" };
  }
  path.reverse();
  return { path, issue: nativeProjection(path, id).issue };
}
