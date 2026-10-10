import { ChevronDownIcon, ChevronRightIcon } from "@radix-ui/react-icons";
import { Button, Heading, Text } from "@radix-ui/themes";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Call, EntrySummary } from "../model.js";
import { Status } from "./components.js";
import { duration, type Filters, matchesCall, output } from "./format.js";
import { flatten, hierarchy, reveal, withAncestors } from "./hierarchy.js";
import { searchNeedle } from "./search.js";
import { TimelineMark } from "./timeline.js";
import { axis } from "./timing.js";

export function CapturedExecutions({
  calls,
  entries,
  selected,
  select,
  open,
  view,
  changeView,
  dropped,
  invalidEvents,
  filters,
  revealSelected,
}: {
  calls: Call[];
  entries: EntrySummary[];
  selected?: string;
  select(id: string): void;
  open: boolean;
  view: string;
  changeView(view: string): void;
  dropped: number;
  invalidEvents: number;
  filters: Filters;
  revealSelected: boolean;
}) {
  const preparedFilters = useMemo(() => ({ ...filters, query: searchNeedle(filters.query) }), [filters]);
  const tree = useMemo(
    () =>
      hierarchy(
        calls.map((call) => ({
          ...call,
          id: call.occurrenceId,
          rawId: call.id,
          rawParentId: call.parentId,
          parentId: call.parentOccurrenceId ?? null,
        })),
      ),
    [calls],
  );
  const keep = useMemo(
    () =>
      withAncestors(
        tree,
        new Set([
          ...calls.filter((call) => matchesCall(call, preparedFilters)).map((call) => call.occurrenceId),
          ...(revealSelected && selected ? [selected] : []),
        ]),
      ),
    [tree, calls, preparedFilters, revealSelected, selected],
  );
  const [expanded, setExpanded] = useState(new Set<string>());
  const previous = useRef<string | undefined>(undefined);
  useEffect(() => {
    const chain: string[] = [];
    let current = selected;
    const visited = new Set<string>();
    while (current && tree.nodes.has(current) && !visited.has(current)) {
      visited.add(current);
      chain.push(current);
      current = tree.nodes.get(current)?.parentId ?? undefined;
    }
    const identity = chain.join("/");
    if (selected && identity !== previous.current && tree.nodes.has(selected)) {
      previous.current = identity;
      setExpanded((old) => reveal(tree, old, selected));
    }
  }, [selected, tree]);
  const rows = flatten(tree, expanded, keep);
  const indent = Math.min(12, 140 / Math.max(1, ...rows.map((row) => row.depth)));
  const range = axis(entries, calls);
  return (
    <section className={`live-drawer ${open ? "drawer-open" : ""}`}>
      <div className="live-drawer-toggle">
        <Heading size="3">Captured executions</Heading>
        <span>
          {calls.length} captured · {calls.filter((call) => call.status === "error").length} errors · {dropped} evicted
        </span>
        <span className="drawer-scope">Session-wide · observed events</span>
      </div>
      {open && (
        <div className="live-drawer-body">
          {invalidEvents > 0 && (
            <Text size="1" color="gray">
              {invalidEvents} invalid live events omitted; correlation unavailable
            </Text>
          )}
          <div className="live-controls">
            <Text size="1" color="gray">
              Reported durations are monotonic execute() timings; bars are observed callback intervals.
            </Text>
            <div className="view-switch">
              {["list", "timeline"].map((mode) => (
                <button type="button" key={mode} aria-pressed={view === mode} onClick={() => changeView(mode)}>
                  {mode === "list" ? "List" : "Timeline"}
                </button>
              ))}
            </div>
            <Button size="1" variant="ghost" disabled={!keep.size} onClick={() => setExpanded(new Set(keep))}>
              Expand calls
            </Button>
            <Button size="1" variant="ghost" onClick={() => setExpanded(new Set())}>
              Collapse calls
            </Button>
          </div>
          {!rows.length && <div className="empty-state">No captured executions match these filters.</div>}
          {rows.map(({ node: call, depth }) => (
            <div
              key={call.id}
              id={`live-call-${call.occurrenceId}`}
              className="live-trace-item"
              data-parent-id={call.parentId ?? ""}
              data-raw-id={call.rawId}
              style={{ marginLeft: depth * indent }}
            >
              <div className={`live-call-row ${selected === call.id ? "selected" : ""}`}>
                <button
                  type="button"
                  className="expand-button"
                  aria-label={`Expand call ${call.id}`}
                  aria-expanded={expanded.has(call.id)}
                  onClick={() =>
                    setExpanded((old) => {
                      const next = new Set(old);
                      if (next.has(call.id)) next.delete(call.id);
                      else next.add(call.id);
                      return next;
                    })
                  }
                >
                  {expanded.has(call.id) ? <ChevronDownIcon /> : <ChevronRightIcon />}
                </button>
                <button
                  type="button"
                  className="call-trigger"
                  aria-label={`${call.name} · ${call.status}`}
                  onClick={() => select(call.id)}
                >
                  <strong title={call.name}>{call.name}</strong>
                  <span className="call-summary" title={output(call.args.value)}>
                    {output(call.args.value).replace(/\s+/g, " ").slice(0, 120)}
                  </span>
                  <code title={call.rawId}>{call.rawId.slice(0, 16)}</code>
                  <Status value={call.status} />
                  <span>{duration(call.durationMs)}</span>
                </button>
                {view === "timeline" && (
                  <TimelineMark
                    range={range}
                    call={{
                      ...call,
                      id: call.rawId,
                      parentId: call.parentOccurrenceId
                        ? (calls.find((parent) => parent.occurrenceId === call.parentOccurrenceId)?.id ??
                          call.rawParentId)
                        : call.rawParentId,
                    }}
                  />
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
