import type { Call, Capture, EntrySummary, Json } from "../model.js";

export function output(value: Json): string {
  return typeof value === "string" ? value : JSON.stringify(value, null, 2);
}
export function record(value: Json | undefined): { [key: string]: Json } | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value : undefined;
}
export function duration(ms?: number): string {
  return ms === undefined ? "—" : ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`;
}
export function count(value?: number): string {
  return value === undefined ? "—" : value.toLocaleString("en-US");
}
export function time(value: string): string {
  return /^\d{4}-\d\d-\d\dT/.test(value) ? value.slice(11, 19) : value || "—";
}
export function group(kind: string): string {
  return ["assistant", "model_change", "thinking_level_change"].includes(kind)
    ? "Model"
    : kind === "toolResult"
      ? "Tool"
      : ["custom", "custom_message"].includes(kind)
        ? "Custom"
        : "Other";
}
export function eventName(kind: string): string {
  return kind === "assistant" ? "model" : kind === "toolResult" ? "tool_result" : kind;
}
export interface Filters {
  query: string;
  kind: string;
  groups: string[];
  errorsOnly: boolean;
  slowOnly: boolean;
}
export function matches(entry: EntrySummary, filters: Filters, calls: Call[]): boolean {
  const call = calls.find(
    (call) =>
      call.id === entry.toolCallId &&
      call.branchAnchor === entry.toolAnchor &&
      !call.parentOccurrenceId &&
      !call.correlationUnavailable,
  );
  return (
    (filters.kind === "all" || entry.kind === filters.kind) &&
    (!filters.groups.length || filters.groups.includes(group(entry.kind))) &&
    (!filters.errorsOnly || entry.status === "error" || call?.status === "error") &&
    (!filters.slowOnly || (call?.durationMs ?? 0) > 10000) &&
    `${entry.kind} ${entry.name ?? ""} ${entry.label} ${entry.summary ?? ""} ${entry.id}`
      .toLowerCase()
      .includes(filters.query)
  );
}
export function matchesCall(call: Call, filters: Filters): boolean {
  return (
    (!filters.groups.length || filters.groups.includes("Tool")) &&
    (!filters.errorsOnly || call.status === "error") &&
    (!filters.slowOnly || (call.durationMs ?? 0) > 10000) &&
    `${call.name} ${call.id}`.toLowerCase().includes(filters.query) &&
    (filters.kind === "all" || filters.kind === "toolResult")
  );
}
export function promptDiff(before?: Capture, after?: Capture): Capture {
  const left = before ? output(before.value).split("\n") : [];
  const right = after ? output(after.value).split("\n") : [];
  let start = 0;
  let end = 0;
  while (start < left.length && start < right.length && left[start] === right[start]) start++;
  while (
    end < left.length - start &&
    end < right.length - start &&
    left[left.length - end - 1] === right[right.length - end - 1]
  )
    end++;
  return {
    value:
      [
        ...left.slice(start, left.length - end).map((line) => `- ${line}`),
        ...right.slice(start, right.length - end).map((line) => `+ ${line}`),
      ].join("\n") || "No prompt change",
    truncated: Boolean(before?.truncated || after?.truncated),
  };
}
export function scripts(data?: Capture): Capture | undefined {
  const message = record(record(data?.value)?.message);
  if (!message || !Array.isArray(message.content)) return;
  const code = message.content.flatMap((block) => {
    const item = record(block);
    const args = record(item?.arguments);
    return item?.type === "toolCall" && item.name === "codemode" && typeof args?.code === "string" ? [args.code] : [];
  });
  return code.length ? { value: code.join("\n\n"), truncated: Boolean(data?.truncated) } : undefined;
}
