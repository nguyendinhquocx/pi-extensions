import type { ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { runDocumentReview } from "@narumitw/pi-tui-kit";

/** Cell-exact scrolling in TUI and paginated observable confirmation in RPC. */
export async function confirmMergeReview(
  ctx: ExtensionCommandContext | ExtensionContext,
  title: string,
  content: string,
  signal: AbortSignal | undefined,
  isCurrent: () => boolean,
  confirmationLabel = "Apply merged transfer",
) {
  const result = await runDocumentReview(ctx, {
    title,
    content,
    format: { kind: "text" },
    viewportSize: "adaptive",
    confirmation: { label: confirmationLabel },
    hint: "close",
    signal,
    isCurrent,
    onError: () => {},
  });
  if (result.kind === "error") throw new Error("Merge review failed; no transfer was performed.");
  if (result.kind === "unsupported")
    throw new Error("Merge review requires observable TUI or RPC; review the plan before using --yes.");
  return result.kind === "confirmed";
}
