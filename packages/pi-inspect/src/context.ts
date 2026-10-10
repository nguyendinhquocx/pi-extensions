import { createHash } from "node:crypto";
import { buildSessionProjection, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { ancestry } from "./ancestry.js";
import type { EntryIndex } from "./entry-index.js";
import { recordedLeaf } from "./identity.js";
import type { ContextComposition, ContextSegment, Json } from "./model.js";
import { capture } from "./privacy.js";

function object(value: Json | undefined): Record<string, Json> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value : undefined;
}
export function captureContext(
  input: readonly unknown[],
  source: ContextComposition["source"],
  leafId: string | null,
): ContextComposition {
  const result: ContextComposition = {
    source,
    leafId,
    totalMessages: input.length,
    messages: [],
    segments: [],
    incomplete: false,
  };
  const occurrences = new Map<string, number>();
  let budget = 1048576;
  for (const message of input) {
    if (result.segments.length >= 4000 || budget <= 64) {
      result.incomplete = true;
      break;
    }
    const raw = capture(message, Math.min(8192, budget));
    const encoded = JSON.stringify(raw);
    budget -= encoded.length;
    result.incomplete ||= raw.truncated;
    const data = object(raw.value);
    const role = typeof data?.role === "string" ? data.role : "unknown";
    const index = result.messages.length;
    result.messages.push(raw);
    const hash = createHash("sha256").update(encoded).digest("hex").slice(0, 20);
    const occurrence = occurrences.get(hash) ?? 0;
    occurrences.set(hash, occurrence + 1);
    const content = data?.content === "" && data?.sections ? data.sections : data?.content;
    const blocks = Array.isArray(content) && content.length ? content : [content ?? data?.sections ?? raw.value];
    for (const [blockIndex, block] of blocks.entries()) {
      if (result.segments.length >= 4000) {
        result.incomplete = true;
        break;
      }
      const item = object(block);
      const kind = typeof item?.type === "string" ? item.type : role;
      const category: ContextSegment["category"] =
        role === "system" || role === "developer"
          ? "system"
          : role === "user"
            ? "user"
            : role === "toolResult" || role === "tool"
              ? "toolResult"
              : role === "assistant" && kind === "toolCall"
                ? "toolCall"
                : role === "assistant"
                  ? "assistant"
                  : "other";
      const preview = item?.name ?? item?.text ?? item?.thinking ?? block;
      const timestamp =
        typeof data?.timestamp === "string"
          ? data.timestamp
          : typeof data?.timestamp === "number" &&
              Number.isFinite(data.timestamp) &&
              Math.abs(data.timestamp) < 8640000000000000
            ? new Date(data.timestamp).toISOString()
            : undefined;
      result.segments.push({
        id: `${source}-${hash}-${occurrence}-${blockIndex}`,
        position: result.segments.length + 1,
        messageIndex: index,
        ...(Array.isArray(content) && content.length ? { blockIndex } : {}),
        role,
        kind,
        category,
        preview: (typeof preview === "string" ? preview : JSON.stringify(preview)).slice(0, 240),
        ...(timestamp ? { timestamp } : {}),
      });
    }
  }
  result.incomplete ||= result.messages.length < input.length;
  return result;
}
export function sessionContext(manager: ExtensionContext["sessionManager"], index: EntryIndex): ContextComposition {
  const leafId = recordedLeaf(manager, index.duplicates);
  const validation = leafId ? ancestry(manager, leafId, index) : { path: [], issue: "No unambiguous active leaf" };
  if (validation.issue)
    return {
      source: "session-derived",
      leafId,
      totalMessages: 0,
      messages: [],
      segments: [],
      incomplete: true,
      unavailable: validation.issue,
    };
  try {
    return captureContext(buildSessionProjection(validation.path, leafId).messages, "session-derived", leafId);
  } catch {
    return {
      source: "session-derived",
      leafId,
      totalMessages: 0,
      messages: [],
      segments: [],
      incomplete: true,
      unavailable: "Native context projection unavailable",
    };
  }
}
