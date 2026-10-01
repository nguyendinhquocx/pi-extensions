import { terminalText } from "./terminal.js";

function isOAuthOperationRejection(message: string): boolean {
  // Pi's adapter exposes a formatted error string, not the SDK's structured error.
  // Require the exact returned code/type pair; a mention in diagnostic prose is not evidence.
  const start = message.indexOf("{");
  if (start < 0) return false;
  try {
    const body: unknown = JSON.parse(message.slice(start));
    if (!body || typeof body !== "object") return false;
    const error = "error" in body ? body.error : body;
    return (
      !!error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "hardened_oauth_rule_missing" &&
      "type" in error &&
      error.type === "rejected_by_hardened_oauth_boundary"
    );
  } catch {
    return false;
  }
}

function redactRequestValues(message: string, requestValues: readonly string[]): string {
  const values = new Set<string>();
  for (const value of requestValues) {
    if (!value) continue;
    values.add(value);
    // Header-owned auth can omit apiKey; redact a bare bearer or Basic credential too.
    const credential = /^(?:Bearer|Basic)\s+(.+)$/i.exec(value)?.[1];
    if (credential) values.add(credential);
  }
  const representations = [...values].flatMap((value) => [value, JSON.stringify(value).slice(1, -1)]);
  for (const value of [...new Set(representations)].sort((a, b) => b.length - a.length)) {
    message = message.split(value).join("[redacted]");
  }
  return message;
}

export function compactionFailureMessage(error: unknown, requestValues: readonly string[] = []): string {
  const raw = error instanceof Error ? error.message : String(error);
  const guidance = isOAuthOperationRejection(raw)
    ? "ChatGPT OAuth is not authorized for this compaction operation; using Pi compaction. " +
      "To avoid repeated rejected attempts, disable remote compaction in /codex-compact Settings only in sessions " +
      "without an opaque checkpoint; disabling also stops checkpoint replay. "
    : "Responses compaction failed; using Pi compaction. ";
  return guidance + terminalText(redactRequestValues(raw, requestValues));
}
