// Native historical replay is allowed only within this cumulative input budget.
export const SYSTEM_REPLAY_CHARACTERS = 1_048_576;
export const SYSTEM_REPLAY_TOOL_DELTAS = 2048;

export function systemReplayIssue(messages: readonly unknown[]): string | undefined {
  let remaining = SYSTEM_REPLAY_CHARACTERS;
  let deltas = SYSTEM_REPLAY_TOOL_DELTAS;
  let nodes = 16_384;
  const seen = new WeakSet<object>();
  // Count raw lengths without serializing, sanitizing, or materializing large metadata.
  function declaration(value: unknown, depth = 0): boolean {
    if (--nodes < 0 || depth > 32) return false;
    if (typeof value === "string") {
      remaining -= value.length;
      return remaining >= 0;
    }
    if (!value || typeof value !== "object" || seen.has(value)) return true;
    seen.add(value);
    if (Array.isArray(value) && value.length > nodes) return false;
    for (const key in value) {
      if (!Object.hasOwn(value, key)) continue;
      remaining -= key.length + 2;
      if (remaining < 0) return false;
      const property = Object.getOwnPropertyDescriptor(value, key);
      if (property?.get || property?.set || !declaration(property?.value, depth + 1)) return false;
    }
    return true;
  }
  for (const value of messages) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const m = value as Record<string, unknown>;
    if (m.role !== "system") continue;
    for (const [kind, delta] of [
      ["added", m.toolsAdded],
      ["removed", m.toolsRemoved],
    ] as const) {
      if (!Array.isArray(delta)) continue;
      deltas -= delta.length;
      if (deltas < 0) return "system tool replay exceeds 2,048 cumulative delta budget";
      for (const tool of delta) {
        if (
          !declaration(
            kind === "added"
              ? { name: tool.name, description: tool.description, parameters: tool.parameters }
              : { name: tool.name },
          )
        )
          return "system tool replay exceeds metadata character/node/depth budget";
      }
    }
    remaining -= 2; // Bound join separators even for empty fragments.
    if (typeof m.content === "string") remaining -= m.content.length;
    else if (Array.isArray(m.content)) {
      remaining -= m.content.length; // Also bound native filter/map work and block separators.
      if (remaining < 0) return "system replay exceeds 1,048,576-character input budget";
      for (const block of m.content) {
        if (block?.type === "text" && typeof block.text === "string") remaining -= block.text.length;
        if (remaining < 0) return "system replay exceeds 1,048,576-character input budget";
      }
    }
    if (remaining < 0) return "system replay exceeds 1,048,576-character input budget";
    if (m.sections && typeof m.sections === "object") {
      for (const [key, part] of Object.entries(m.sections)) {
        remaining -= key.length + 2 + (typeof part === "string" ? part.length : 0);
        if (remaining < 0) return "system replay exceeds 1,048,576-character input budget";
      }
    }
  }
  return undefined;
}

// Validate the fields consumed by Pi AI's system-prompt/tool replay. Checkpoints
// are injected directly; ordinary session messages are normalized by the caller.
export function systemMessageIssue(value: unknown): string | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "malformed system-message envelope";
  const m = value as Record<string, unknown>;
  if (m.role !== "system") return "malformed system-message role";
  if (Array.isArray(m.content) && m.content.length > 2048) return "system content exceeds 2,048-block budget";
  if (
    typeof m.content !== "string" &&
    (!Array.isArray(m.content) ||
      m.content.some(
        (block) =>
          !block ||
          typeof block !== "object" ||
          Array.isArray(block) ||
          (block.type === "text" && typeof block.text !== "string"),
      ))
  )
    return "malformed system-message content";
  if (
    m.sections != null &&
    (typeof m.sections !== "object" ||
      Array.isArray(m.sections) ||
      Object.values(m.sections).some((part) => part !== null && typeof part !== "string"))
  )
    return "malformed system-message sections";
  for (const delta of [m.toolsAdded, m.toolsRemoved]) {
    if (Array.isArray(delta) && delta.length > SYSTEM_REPLAY_TOOL_DELTAS)
      return "system tool delta exceeds 2,048-entry budget";
    if (
      delta != null &&
      (!Array.isArray(delta) ||
        delta.some(
          (tool) =>
            !tool ||
            typeof tool !== "object" ||
            Array.isArray(tool) ||
            typeof tool.name !== "string" ||
            !tool.name.length ||
            tool.name.length > 512,
        ))
    )
      return "malformed system-message tool delta";
  }
  return undefined;
}
