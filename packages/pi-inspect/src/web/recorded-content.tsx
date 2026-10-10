import type { Capture } from "../model.js";
import { Data } from "./components.js";
import { record } from "./format.js";

export function RecordedContent({ data, scope }: { data?: Capture; scope: string }) {
  const raw = record(data?.value);
  const message = record(raw?.message);
  const content =
    message && Object.hasOwn(message, "content")
      ? message.content
      : raw && Object.hasOwn(raw, "data")
        ? raw.data
        : (raw?.content ?? raw?.summary ?? raw);
  const blocks = Array.isArray(content) ? content : [content];
  return (
    <div className="recorded-content">
      {blocks.slice(0, 128).map((block, index) => {
        const item = record(block);
        const name = typeof item?.name === "string" ? item.name : "unknown";
        const label =
          item?.type === "thinking"
            ? "Thinking"
            : item?.type === "toolCall"
              ? `Tool call · ${name}`
              : "Recorded content";
        return (
          <Data
            // biome-ignore lint/suspicious/noArrayIndexKey: Historical content blocks are immutable and scoped by entry identity.
            key={`${scope}-${index}`}
            label={label}
            data={
              data && {
                value: item?.text ?? item?.thinking ?? item?.arguments ?? block ?? null,
                truncated: data.truncated || blocks.length > 128,
              }
            }
            scope={`${scope}-content-${index}`}
          />
        );
      })}
      <Data
        label="Metadata and Raw JSON · redacted display copy"
        data={data}
        scope={`${scope}-raw`}
        defaultOpen={false}
      />
    </div>
  );
}
