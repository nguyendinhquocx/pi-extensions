import { ChevronDownIcon, ChevronRightIcon, MagnifyingGlassIcon } from "@radix-ui/react-icons";
import { Heading, TextField } from "@radix-ui/themes";
import { useEffect, useMemo, useState } from "react";
import type { ContextComposition as Composition, ContextSegment, Snapshot } from "../model.js";
import { Data, Glyph, Metadata } from "./components.js";
import { output, record, time } from "./format.js";
import { boundedSearch, searchNeedle } from "./search.js";
import { useVirtualContext } from "./virtual-context.js";

const categories = ["system", "user", "assistant", "toolCall", "toolResult", "other"] as const;
const names: Record<string, string> = {
  system: "System prompt",
  user: "User message",
  assistant: "Assistant",
  toolCall: "Tool call",
  toolResult: "Tool result",
  other: "Other",
};
export function ContextComposition({
  context,
  payload,
  preview = false,
}: {
  context?: Composition;
  payload?: Snapshot["providerObservation"];
  preview?: boolean;
}) {
  const [query, search] = useState("");
  const [category, filter] = useState("all");
  const [expanded, expand] = useState(new Set<string>());
  const [selected, select] = useState("");
  const segments = context?.segments;
  const needle = useMemo(() => searchNeedle(query), [query]);
  const searchable = useMemo(
    () => context?.messages.map((message) => output(message.value).toLowerCase()) ?? [],
    [context?.messages],
  );
  const rows = useMemo(
    () =>
      (segments ?? []).filter((segment) => {
        const message = searchable[segment.messageIndex] ?? "";
        return (
          (category === "all" || segment.category === category) &&
          (`${segment.role} ${segment.kind} ${segment.preview}`.toLowerCase().includes(needle) ||
            message.includes(needle))
        );
      }),
    [segments, category, needle, searchable],
  );
  const ids = useMemo(() => rows.map((row) => row.id), [rows]);
  const virtual = useVirtualContext(ids);
  const [focused, focus] = useState("");
  const visibleRows = rows.slice(virtual.range.start, virtual.range.end);
  const tabTarget = visibleRows.some((row) => row.id === focused) ? focused : visibleRows[0]?.id;
  useEffect(() => {
    const valid = new Set(segments?.map((row) => row.id));
    expand((old) => new Set([...old].filter((id) => valid.has(id))));
    if (selected && !valid.has(selected)) select("");
  }, [segments, selected]);
  function toggle(id: string): void {
    select(id);
    expand((old) => {
      const next = new Set(old);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  const bucket = Math.max(1, Math.ceil(rows.length / 160));
  return (
    <section className="context-composition" aria-label="Context composition">
      <div className="composition-heading">
        <div>
          <Heading size="5">Context composition</Heading>
          <span className="composition-count">
            {rows.length} captured segments · {context?.totalMessages ?? 0} messages · segment tokens unavailable
          </span>
        </div>
        <fieldset className="context-filters" aria-label="Context category">
          {[
            ["all", "All"],
            ["system", "System"],
            ["user", "User"],
            ["assistant", "Assistant"],
            ["toolCall", "Tool call"],
            ["toolResult", "Tool result"],
          ].map(([value, label]) => (
            <button
              type="button"
              key={value}
              aria-pressed={category === value}
              onClick={() => {
                filter(value ?? "all");
                virtual.reset();
              }}
            >
              {label}
            </button>
          ))}
        </fieldset>
        <TextField.Root
          aria-label="Search context"
          placeholder="Search captured context…"
          value={query}
          onChange={(event) => {
            search(boundedSearch(event.target.value));
            virtual.reset();
          }}
        >
          <TextField.Slot>
            <MagnifyingGlassIcon />
          </TextField.Slot>
        </TextField.Root>
      </div>
      <div className="context-provenance" role="status">
        {preview
          ? "Session-derived preview · selected branch projection; not a captured historical request."
          : context?.source === "observed-pi-context"
            ? "Last observed Pi context · context_with_system stage; later hooks and provider serialization may differ."
            : "Session-derived context · native active-leaf projection; request-local hooks and provider serialization are unavailable."}
        {context?.observedAt && (
          <span>
            {" "}
            Observed {new Date(context.observedAt).toLocaleTimeString()} · leaf {context.leafId ?? "unavailable"}
          </span>
        )}
        {!context?.observedAt && <span> Leaf {context?.leafId ?? "unavailable"}.</span>}
        {context?.incomplete && (
          <strong> Bounded capture is incomplete; only available captured content is searchable.</strong>
        )}
        {context?.unavailable && <strong> Unavailable: {context.unavailable}.</strong>}
      </div>
      <div className="composition-body">
        <section
          className="context-scroll"
          ref={virtual.scroller}
          onScroll={virtual.refresh}
          aria-label="Context segments"
        >
          <div className="virtual-segments" style={{ height: virtual.totalHeight }}>
            {visibleRows.map((segment, localIndex) => {
              const index = virtual.range.start + localIndex;
              const position = virtual.positions[index];
              const open = expanded.has(segment.id);
              return (
                <div
                  key={segment.id}
                  className="context-segment"
                  data-segment-id={segment.id}
                  data-category={segment.category}
                  style={{ top: position?.top }}
                  ref={(element) => {
                    if (element) virtual.elements.current.set(segment.id, element);
                    else virtual.elements.current.delete(segment.id);
                  }}
                >
                  <button
                    type="button"
                    className={`segment-row ${selected === segment.id ? "selected" : ""}`}
                    tabIndex={tabTarget === segment.id ? 0 : -1}
                    aria-expanded={open}
                    aria-label={`${segment.position} ${segment.role === "developer" ? "Developer" : names[segment.category]} ${segment.preview}`}
                    onFocus={() => focus(segment.id)}
                    onClick={() => toggle(segment.id)}
                    onKeyDown={(event) => {
                      if (event.target !== event.currentTarget || event.ctrlKey || event.altKey || event.metaKey)
                        return;
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        toggle(segment.id);
                      } else if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
                        event.preventDefault();
                        virtual.jump(
                          event.key === "Home"
                            ? 0
                            : event.key === "End"
                              ? rows.length - 1
                              : Math.max(0, Math.min(rows.length - 1, index + (event.key === "ArrowDown" ? 1 : -1))),
                          true,
                        );
                      } else if ((event.key === "ArrowRight" && !open) || (event.key === "ArrowLeft" && open)) {
                        event.preventDefault();
                        toggle(segment.id);
                      }
                    }}
                  >
                    <span className="segment-position">{segment.position}</span>
                    <Glyph kind={segment.category} />
                    <strong>
                      {segment.role === "developer" ? "Developer" : names[segment.category]}
                      {segment.category === "assistant" && segment.kind !== "assistant" && segment.kind !== "text"
                        ? ` · ${segment.kind}`
                        : ""}
                    </strong>
                    <span className="segment-preview" title={segment.preview}>
                      {segment.preview}
                    </span>
                    {segment.timestamp && <time title={segment.timestamp}>{time(segment.timestamp)}</time>}
                    <span className="segment-chevron" aria-hidden="true">
                      {open ? <ChevronDownIcon /> : <ChevronRightIcon />}
                    </span>
                  </button>
                  {open && context && <SegmentDetails key={segment.id} segment={segment} context={context} />}
                </div>
              );
            })}
          </div>
          {!rows.length && (
            <div className="empty-state">
              No captured segments match. This view does not include unrelated session events.
            </div>
          )}
        </section>
        <nav className="context-minimap" aria-label="Context minimap">
          {Array.from({ length: Math.ceil(rows.length / bucket) }, (_, index) => {
            const start = index * bucket;
            const end = Math.min(rows.length, start + bucket);
            const group = rows.slice(start, end);
            return (
              <button
                type="button"
                key={group[0]?.id}
                aria-label={`Jump to context position ${group[0]?.position}`}
                title={`Filtered rows ${start + 1}–${end}`}
                aria-current={start < virtual.viewport.end && end > virtual.viewport.start ? "true" : undefined}
                onClick={() => virtual.jump(start, true)}
              >
                {categories.map((value) => {
                  const size = group.filter((row) => row.category === value).length;
                  return size ? <span key={value} data-category={value} style={{ flex: size }} /> : null;
                })}
              </button>
            );
          })}
        </nav>
      </div>
      <div className="composition-footer">
        <span>Messages and supported content blocks in source order · filtered minimap</span>
        <span>
          {Math.min(rows.length, virtual.range.start + 1)}–{Math.min(rows.length, virtual.range.end)} / {rows.length}
        </span>
      </div>
      {payload && (
        <details className="provider-observation">
          <summary>
            Advanced · independent provider observation (request association unavailable; may include warming/retries)
          </summary>
          <span>
            Observed {new Date(payload.observedAt).toLocaleTimeString()} · not attributed to the context leaf/turn
          </span>
          <Data
            label="Observed provider payload · redacted bounded copy"
            data={payload.data}
            scope="observed-provider-payload"
          />
        </details>
      )}
    </section>
  );
}
function SegmentDetails({ segment, context }: { segment: ContextSegment; context: Composition }) {
  const raw = context.messages[segment.messageIndex];
  const message = record(raw?.value);
  const block =
    segment.blockIndex === undefined
      ? message?.content === "" && message?.sections
        ? message.sections
        : (message?.content ?? message?.sections ?? raw?.value)
      : Array.isArray(message?.content)
        ? message.content[segment.blockIndex]
        : undefined;
  const item = record(block);
  const content = item?.text ?? item?.thinking ?? item?.arguments ?? block;
  return (
    <div className="segment-details">
      <section className="message-details">
        <h3>Message details</h3>
        <Metadata
          rows={[
            ["Role", segment.role],
            ["Type", segment.kind],
            ["Position", `${segment.position} / ${context.segments.length}`],
            ["Source message", `${segment.messageIndex + 1} / ${context.totalMessages}`],
            ...(segment.blockIndex === undefined
              ? []
              : [["Content block", String(segment.blockIndex + 1)] as [string, string]]),
            ["Timestamp", segment.timestamp],
            ["Tokens", "Unavailable for this segment"],
          ]}
        />
      </section>
      <div className="segment-content">
        <Data
          label="Content"
          data={raw ? { value: content ?? null, truncated: raw.truncated } : undefined}
          scope={`${segment.id}-content`}
        />
        {item?.type === "toolCall" && (
          <Data
            label={`Tool arguments · ${typeof item.name === "string" ? item.name : "unknown"}`}
            data={{ value: item.arguments ?? null, truncated: Boolean(raw?.truncated) }}
            scope={`${segment.id}-arguments`}
            defaultOpen={false}
          />
        )}
        <Data
          label="Structured content"
          data={raw ? { value: block ?? null, truncated: raw.truncated } : undefined}
          scope={`${segment.id}-structured`}
          defaultOpen={false}
        />
        <Data
          label="Metadata"
          data={
            raw
              ? {
                  value: Object.fromEntries(Object.entries(message ?? {}).filter(([key]) => key !== "content")),
                  truncated: raw.truncated,
                }
              : undefined
          }
          scope={`${segment.id}-metadata`}
          defaultOpen={false}
        />
        <Data label="Raw JSON · captured message" data={raw} scope={`${segment.id}-raw`} defaultOpen={false} />
      </div>
    </div>
  );
}
