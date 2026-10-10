import type { SessionEntry } from "@earendil-works/pi-coding-agent";

// Rebuilt only at structural boundaries, never once per inline request.
export class EntryIndex {
  readonly byId = new Map<string, SessionEntry>();
  readonly duplicates = new Set<string>();
  constructor(readonly entries: SessionEntry[]) {
    for (const entry of entries)
      if (typeof entry?.id === "string") {
        if (this.byId.has(entry.id)) this.duplicates.add(entry.id);
        this.byId.set(entry.id, entry);
      }
  }
  get(id: string): SessionEntry | undefined {
    return this.duplicates.has(id) ? undefined : this.byId.get(id);
  }
}
