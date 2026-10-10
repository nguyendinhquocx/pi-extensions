import type { EntrySummary } from "../model.js";
import { label } from "./hierarchy.js";

/** Pi bookkeeping entries do not contribute messages; custom_message always does. */
export function internalEntry(entry: EntrySummary): boolean {
  return !entry.status && entry.internal === true;
}
export interface HistoryRow {
  node: EntrySummary;
  turn: string;
  heading?: string;
}
export function history(entries: EntrySummary[], leaf: string | null): { rows: HistoryRow[]; issue?: string } {
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const path: EntrySummary[] = [];
  const seen = new Set<string>();
  let id = leaf;
  let issue: string | undefined;
  while (id) {
    if (seen.has(id)) {
      issue = "Recorded parent cycle; partial history only";
      break;
    }
    if (path.length >= 10000) {
      issue = "History inspection budget exceeded";
      break;
    }
    const entry = byId.get(id);
    if (!entry) {
      issue = "Parent or branch leaf outside indexed data; partial history only";
      break;
    }
    seen.add(id);
    path.push(entry);
    id = entry.parentId;
  }
  if (!leaf) issue = "Active branch leaf unavailable; use Branch view to inspect indexed entries";
  const rows: HistoryRow[] = [];
  let turn = "before-user";
  let first = true;
  for (const node of path.reverse()) {
    const starts = first || node.kind === "user";
    if (node.kind === "user") turn = node.id;
    rows.push({
      node,
      turn,
      heading: starts ? (node.kind === "user" ? "User turn" : "Before first user turn") : undefined,
    });
    first = false;
  }
  return { rows, issue };
}

export function historySummary(entry: EntrySummary): string {
  return entry.summary || (entry.kind === "system" ? "System prompt update" : label(entry));
}
