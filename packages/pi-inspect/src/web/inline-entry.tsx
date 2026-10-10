import { Button, Tabs, Text } from "@radix-ui/themes";
import type { EntrySummary } from "../model.js";
import { useDetail } from "./api.js";
import { Data, Metadata } from "./components.js";
import { count, eventName, record } from "./format.js";
import { label } from "./hierarchy.js";

export function InlineEntry({ entry, inspect }: { entry: EntrySummary; inspect(id: string): void }) {
  const { detail, error, retry } = useDetail(entry.id);
  const raw = record(detail?.raw.value);
  const message = record(raw?.message);
  const content = raw && Object.hasOwn(raw, "data") ? raw.data : message?.content;
  const textBlocks =
    Array.isArray(content) &&
    content.every((block) => {
      const item = record(block);
      return item?.type === "text" && typeof item.text === "string";
    })
      ? content.map((block) => record(block)?.text).join("\n")
      : undefined;
  const preview = textBlocks ?? content;
  const inputs = Array.isArray(message?.content)
    ? message.content.flatMap((block) => {
        const item = record(block);
        return item?.type === "toolCall" ? [item.arguments ?? null] : [];
      })
    : [];
  const usage = record(message?.usage);
  const input = typeof usage?.input === "number" && usage.input >= 0 ? usage.input : undefined;
  const output = typeof usage?.output === "number" && usage.output >= 0 ? usage.output : undefined;
  const known = input !== undefined && output !== undefined;
  return (
    <div className="inline-entry">
      <Tabs.Root defaultValue="overview" className="inline-tabs">
        <Tabs.List>
          <Tabs.Trigger value="overview">Overview</Tabs.Trigger>
          <Tabs.Trigger value="content">Content</Tabs.Trigger>
          <Tabs.Trigger value="raw">Raw</Tabs.Trigger>
          <Tabs.Trigger value="metadata">Metadata</Tabs.Trigger>
        </Tabs.List>
        <Tabs.Content value="overview">
          <div className="inline-summary">
            <Metadata
              rows={[
                ["Type", eventName(entry.kind)],
                ["Description", label(entry)],
                ["Parent ID", entry.parentId ?? "root"],
                ["Timestamp", entry.timestamp],
                ...(entry.tokens === undefined ? [] : [["Tokens", count(entry.tokens)] as [string, string]]),
              ]}
            />
            {known && (
              <div className="usage-breakdown">
                <div className="usage-bar">
                  <span style={{ width: `${input + output ? (input / (input + output)) * 100 : 0}%` }} />
                  <span style={{ width: `${input + output ? (output / (input + output)) * 100 : 0}%` }} />
                </div>
                <span>
                  {count(input)} input · {count(output)} output (cache not included)
                </span>
              </div>
            )}
          </div>
          {content !== undefined && (
            <Data
              label={entry.kind === "toolResult" ? "Recorded tool output" : "Recorded content"}
              data={{ value: preview ?? null, truncated: Boolean(detail?.raw.truncated) }}
              scope={`${entry.id}-content`}
            />
          )}
          {inputs.length > 0 && (
            <Data
              label="Recorded tool arguments"
              data={{ value: inputs, truncated: Boolean(detail?.raw.truncated) }}
              scope={`${entry.id}-arguments`}
              defaultOpen={false}
            />
          )}
          <Button size="1" variant="ghost" onClick={() => inspect(entry.id)}>
            Inspect complete entry →
          </Button>
        </Tabs.Content>
        <Tabs.Content value="content">
          <Data
            label="Recorded content"
            data={
              content === undefined ? undefined : { value: preview ?? null, truncated: Boolean(detail?.raw.truncated) }
            }
            scope={`${entry.id}-content`}
          />
        </Tabs.Content>
        <Tabs.Content value="raw">
          <Data label="Raw entry · redacted display copy" data={detail?.raw} scope={`${entry.id}-raw`} />
        </Tabs.Content>
        <Tabs.Content value="metadata">
          <Metadata
            rows={[
              ["ID", entry.id],
              ["Parent ID", entry.parentId ?? "root"],
              ["Timestamp", entry.timestamp],
              ["Source", "Session log entry, not an execution span"],
            ]}
          />
          <Data label="Contribution at this node" data={detail?.projected} scope={`${entry.id}-projection`} />
        </Tabs.Content>
      </Tabs.Root>
      {error && (
        <div role="alert">
          <Text size="1" color="red">
            {error}
          </Text>
          <Button size="1" variant="ghost" onClick={retry}>
            Retry inline details
          </Button>
        </div>
      )}
      {!detail && !error && (
        <Text size="1" color="gray">
          Loading bounded entry details…
        </Text>
      )}
    </div>
  );
}
