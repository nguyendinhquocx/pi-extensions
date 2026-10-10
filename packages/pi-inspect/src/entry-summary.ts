import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import type { Json } from "./model.js";
import { capture } from "./privacy.js";

/** Summarize only an already redacted, bounded display copy. */
export function readableSummary(entry: SessionEntry): { summary: string; summaryTruncated?: true } {
  const source =
    entry.type === "message"
      ? "content" in entry.message
        ? entry.message.content
        : undefined
      : entry.type === "custom_message"
        ? entry.content
        : entry.type === "compaction" || entry.type === "branch_summary"
          ? entry.summary
          : undefined;
  if (source === undefined || source === null) return { summary: "" };
  const captured = capture(source, 1024);
  const text = (value: Json): string => {
    if (typeof value === "string") return value;
    if (!value || typeof value !== "object") return "";
    if (Array.isArray(value)) return value.map(text).filter(Boolean).join(" · ");
    if (typeof value.text === "string") return value.text;
    if (value.type === "thinking") return "Thinking";
    if (value.type === "image") return "Image";
    if (value.type === "toolCall") return `${value.name ?? "Tool call"} ${JSON.stringify(value.arguments ?? {})}`;
    return "";
  };
  const summary = text(captured.value).replace(/\s+/g, " ").trim();
  return {
    summary: summary.slice(0, 180),
    summaryTruncated: captured.truncated || summary.length > 180 ? true : undefined,
  };
}
