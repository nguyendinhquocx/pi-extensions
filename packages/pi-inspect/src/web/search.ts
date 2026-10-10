// Display-only browser ingestion. Strip complete terminal sequences before bounding the query.
export function boundedSearch(value: string): string {
  return (
    value
      // biome-ignore lint/suspicious/noControlCharactersInRegex: Intentional terminal-control sanitation.
      .replace(/(?:\x1b[\]^_P]|[\x90\x9d\x9e\x9f])[\s\S]*?(?:\x07|\x1b\\|\x9c|$)/g, "")
      // biome-ignore lint/suspicious/noControlCharactersInRegex: Intentional CSI and escape sanitation.
      .replace(/(?:\x1b\[|\x9b)[0-?]*[ -/]*[@-~]|\x1b[ -/]*[@-~]/g, "")
      // biome-ignore lint/suspicious/noControlCharactersInRegex: Search contains no terminal controls.
      .replace(/[\x00-\x1f\x7f-\x9f]/g, "")
      .slice(0, 512)
  );
}
export function searchNeedle(value: string): string {
  return boundedSearch(value).toLowerCase();
}
