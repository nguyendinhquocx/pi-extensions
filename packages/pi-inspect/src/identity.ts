import type { ExtensionContext, SessionEntry } from "@earendil-works/pi-coding-agent";
import { systemMessageIssue } from "./system-message.js";

export const MESSAGE_BLOCKS = 2048;

export function structuralIssue(entry: SessionEntry | undefined): string | undefined {
  if (typeof entry?.id !== "string" || !entry.id.length) return "missing, empty or non-string entry id";
  if (entry.id.length > 512) return "over-budget entry id";
  if (typeof entry.parentId === "string" && entry.parentId.length > 512) return "over-budget parent id";
  if (entry.type === "label" && entry.label !== undefined && typeof entry.label !== "string")
    return "non-string stored label";
  if (entry.parentId !== null && (typeof entry.parentId !== "string" || !entry.parentId.length))
    return "missing, empty or non-string parent id";
  if (entry.type === "session_info" && entry.name !== undefined && typeof entry.name !== "string")
    return "non-string stored session name";
  if (typeof entry.type !== "string" || !entry.type.length) return "missing, empty or non-string entry type";
  if (entry.type === "message" && (typeof entry.message?.role !== "string" || !entry.message.role.length))
    return "missing, empty or non-string message role";
  if (typeof entry.timestamp !== "string") return "non-string entry timestamp";
  if (entry.timestamp.length > 512) return "over-budget entry timestamp";
  return undefined;
}

export function identityIssue(entry: SessionEntry | undefined): string | undefined {
  const structure = structuralIssue(entry);
  if (structure || !entry) return structure;
  if (
    entry.type === "message" &&
    "content" in entry.message &&
    Array.isArray(entry.message.content) &&
    entry.message.content.length > MESSAGE_BLOCKS
  )
    return "message content exceeds 2,048-block budget";
  if (entry.type === "message" && entry.message.role === "system") {
    // Native sessionEntryToContextMessages restores legacy missing/null content.
    const m = entry.message;
    const issue = systemMessageIssue(m.content == null ? { ...m, content: "" } : m);
    if (issue) return issue;
  }
  if (entry.type === "compaction" && entry.systemMessage) {
    const issue = systemMessageIssue(entry.systemMessage);
    if (issue) return `checkpoint: ${issue}`;
  }
  if (
    entry.type === "message" &&
    entry.message.role === "assistant" &&
    entry.message.content != null &&
    (!Array.isArray(entry.message.content) ||
      Array.from(entry.message.content).some((block) => !block || typeof block !== "object" || Array.isArray(block)))
  )
    return "malformed assistant content block or envelope";
  if (
    entry.type === "message" &&
    entry.message.role === "assistant" &&
    Array.isArray(entry.message.content) &&
    entry.message.content.some(
      (block) =>
        block.type === "toolCall" &&
        (!block.arguments ||
          typeof block.arguments !== "object" ||
          Array.isArray(block.arguments) ||
          typeof block.id !== "string" ||
          !block.id.length ||
          block.id.length > 512 ||
          typeof block.name !== "string" ||
          !block.name.length ||
          block.name.length > 512),
    )
  )
    return "malformed tool-call envelope";
  if (entry.type === "context_edit") {
    if (typeof entry.targetId !== "string" || !entry.targetId.length || entry.targetId.length > 512)
      return "malformed context-edit target id";
    const value = entry.replacement;
    if (Array.isArray(value?.content) && value.content.length > MESSAGE_BLOCKS)
      return "context-edit content exceeds 2,048-block budget";
    if (
      value !== null &&
      (!value ||
        typeof value !== "object" ||
        Array.isArray(value) ||
        !("content" in value) ||
        (typeof value.content !== "string" && !Array.isArray(value.content)) ||
        (Array.isArray(value.content) &&
          value.content.some((block) => !block || typeof block !== "object" || Array.isArray(block))))
    )
      return "malformed context-edit replacement";
  }
  if (
    entry.type === "message" &&
    entry.message.role === "toolResult" &&
    (typeof entry.message.toolCallId !== "string" ||
      !entry.message.toolCallId.length ||
      entry.message.toolCallId.length > 512)
  )
    return "malformed or over-budget tool-result id";
  return undefined;
}

export function recordedLeaf(
  manager: ExtensionContext["sessionManager"],
  duplicates?: ReadonlySet<string>,
): string | null {
  const leaf = manager.getLeafId();
  return typeof leaf === "string" &&
    leaf.length > 0 &&
    leaf.length <= 512 &&
    !duplicates?.has(leaf) &&
    !identityIssue(manager.getEntry(leaf))
    ? leaf
    : null;
}
