import { correlatedCalls } from "../correlation.js";
import type { Call, Capture } from "../model.js";
import { record } from "./format.js";
export function entryCalls(raw: Capture | undefined, calls: Call[], anchor?: string): Call[] {
  const message = record(record(raw?.value)?.message);
  const ids = new Set<string>();
  if (message?.role === "toolResult" && typeof message.toolCallId === "string") ids.add(message.toolCallId);
  if (message?.role === "assistant" && Array.isArray(message.content))
    for (const block of message.content) {
      const item = record(block);
      if (item?.type === "toolCall" && typeof item.id === "string") ids.add(item.id);
    }
  return correlatedCalls(ids, anchor, calls);
}
