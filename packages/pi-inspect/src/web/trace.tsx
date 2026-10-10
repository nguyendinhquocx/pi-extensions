import { ChevronDownIcon, ChevronRightIcon, ListBulletIcon, RowsIcon } from "@radix-ui/react-icons";
import { Button, Flex, Heading, Text } from "@radix-ui/themes";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Call, EntrySummary } from "../model.js";
import { Glyph, Status } from "./components.js";
import { count, eventName, time } from "./format.js";
import { flatten, hierarchy, label, reveal, withAncestors } from "./hierarchy.js";
import { type HistoryRow, historySummary } from "./history.js";
import { InlineEntry } from "./inline-entry.js";
import { TimelineMark } from "./timeline.js";
import { axis } from "./timing.js";

export function scrollWithin(container: HTMLElement, element: HTMLElement): void {
  const parent = container.getBoundingClientRect();
  const child = element.getBoundingClientRect();
  if (child.top < parent.top) container.scrollTop -= Math.ceil(parent.top - child.top);
  else if (child.bottom > parent.bottom) container.scrollTop += Math.ceil(child.bottom - parent.bottom);
}
export function Trace({
  entries,
  matches,
  selected,
  serial,
  revealSelected,
  select,
  view,
  changeView,
  calls,
  historyRows,
  active = true,
}: {
  entries: EntrySummary[];
  matches: Set<string>;
  selected: string;
  serial: number;
  revealSelected: boolean;
  select(id: string): void;
  view: string;
  changeView(view: string): void;
  calls: Call[];
  historyRows?: HistoryRow[];
  active?: boolean;
}) {
  const tree = useMemo(() => hierarchy(entries), [entries]);
  const keep = useMemo(
    () => withAncestors(tree, new Set([...matches, ...(revealSelected && selected ? [selected] : [])])),
    [tree, matches, revealSelected, selected],
  );
  const [expanded, setExpanded] = useState(new Set<string>());
  const [disclosed, setDisclosed] = useState(new Set<string>());
  const [offset, setOffset] = useState(0);
  const [focused, setFocused] = useState("");
  const lastReveal = useRef(-1);
  const focusRequest = useRef(false);
  const scroller = useRef<HTMLDivElement>(null);
  const rowRefs = useRef(new Map<string, HTMLDivElement>());
  const rows = useMemo(
    () =>
      historyRows
        ? historyRows
            .filter(({ node }) => matches.has(node.id) || (revealSelected && node.id === selected))
            .map((row, index, visible) => ({
              ...row,
              depth: 0,
              childCount: 0,
              heading:
                index === 0 || visible[index - 1]?.turn !== row.turn
                  ? row.turn === "before-user"
                    ? "Before first user turn"
                    : "User turn"
                  : undefined,
            }))
        : flatten(tree, expanded, keep),
    [tree, expanded, keep, historyRows, matches, revealSelected, selected],
  );
  const pageRows = rows.slice(offset, offset + 50);
  const visibleFocused = pageRows.some((row) => row.node.id === focused) ? focused : (pageRows[0]?.node.id ?? "");
  const baseDepth = pageRows.length ? Math.min(...pageRows.map((row) => row.depth)) : 0;
  const relativeDepth = Math.max(1, ...pageRows.map((row) => row.depth - baseDepth));
  const indent = Math.min(14, 140 / relativeDepth); // Scale the visual rail, never cap hierarchy depth.
  const range = useMemo(() => axis(entries, calls), [entries, calls]);
  useEffect(() => {
    if (!tree.nodes.has(selected) || serial === lastReveal.current) return;
    const next = historyRows ? expanded : reveal(tree, expanded, selected);
    const index = (historyRows ? rows : flatten(tree, next, keep)).findIndex((row) => row.node.id === selected);
    if (index >= 0) {
      // Keep reveal pending until the selection belongs to this projection.
      lastReveal.current = serial;
      if (!historyRows) setExpanded(next);
      setOffset(Math.floor(index / 50) * 50);
      setFocused(selected);
    }
  }, [tree, selected, serial, expanded, keep, historyRows, rows]);
  useEffect(() => {
    const element = rowRefs.current.get(visibleFocused);
    if (!element || !scroller.current) return;
    if (focusRequest.current) {
      element.focus({ preventScroll: true });
      focusRequest.current = false;
    }
    scrollWithin(scroller.current, element);
  }, [visibleFocused]);
  useEffect(() => {
    if (offset >= rows.length && offset) setOffset(Math.max(0, Math.floor((rows.length - 1) / 50) * 50));
  }, [offset, rows.length]);
  function toggle(id: string): void {
    setExpanded((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setDisclosed((previous) => new Set([...previous, id]));
  }
  function focus(id: string): void {
    const index = rows.findIndex((row) => row.node.id === id);
    if (index === -1) return;
    focusRequest.current = true;
    setOffset(Math.floor(index / 50) * 50);
    setFocused(id);
    rowRefs.current.get(id)?.focus({ preventScroll: true });
  }
  return (
    <section className={`panel trace-panel trace-${view} ${historyRows ? "trace-history" : "trace-branches"}`}>
      <div className="trace-toolbar">
        <Heading size="3">{historyRows ? "History" : "Branch view"}</Heading>
        <Text size="1" color="gray">
          {historyRows ? "Conversation groups · not execution parentage" : "Actual session ancestry · not a call stack"}
        </Text>
        <div className="trace-actions">
          <Button
            size="1"
            variant="ghost"
            disabled={!keep.size}
            onClick={() => {
              setExpanded(new Set(keep));
              setDisclosed(new Set(keep));
            }}
          >
            Expand all
          </Button>
          <Button size="1" variant="ghost" disabled={!expanded.size} onClick={() => setExpanded(new Set())}>
            Collapse all
          </Button>
          <div className="view-switch">
            {["list", "timeline"].map((mode) => (
              <button type="button" key={mode} aria-pressed={view === mode} onClick={() => changeView(mode)}>
                {mode === "list" ? <ListBulletIcon /> : <RowsIcon />}
                {mode === "list" ? "List" : "Timeline"}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="trace-hint">
        Row: select · Chevron: toggle only · ↑↓ navigate · ←→ collapse/expand · Enter select · Space toggle
      </div>
      {view === "timeline" && (
        <div className="time-axis">
          <span>{range ? new Date(range.start).toISOString().slice(11, 23) : "No timing"}</span>
          <span>● Log timestamp · ▰ Observed tool interval (captured executions)</span>
          <span>{range ? new Date(range.end).toISOString().slice(11, 23) : "—"}</span>
        </div>
      )}
      <div className="trace-scroll" ref={scroller}>
        <div role="tree" aria-label="Session trace" className="trace-tree">
          {!rows.length && (
            <div className="empty-state">
              {historyRows
                ? "No visible entries match in this branch. Check filters or Show internal events."
                : "No entries match. Filters keep actual ancestor context."}
            </div>
          )}
          {pageRows.map(({ node: entry, depth, childCount, ...group }) => {
            const open = expanded.has(entry.id);
            const selectedRow = selected === entry.id;
            return (
              <div
                className="trace-item"
                key={entry.id}
                data-trace-entry-id={entry.id}
                data-parent-id={entry.parentId ?? ""}
                data-depth={depth}
                data-state={open ? "open" : "closed"}
                style={{ marginLeft: (depth - baseDepth) * indent }}
              >
                {"heading" in group && typeof group.heading === "string" && (
                  <div className="turn-heading">{group.heading}</div>
                )}
                <div
                  role="treeitem"
                  aria-level={depth + 1}
                  aria-expanded={open}
                  aria-selected={selectedRow}
                  aria-current={selectedRow ? "true" : undefined}
                  data-entry-id={entry.id}
                  data-match={matches.has(entry.id)}
                  tabIndex={visibleFocused === entry.id ? 0 : -1}
                  ref={(element) => {
                    if (element) rowRefs.current.set(entry.id, element);
                    else rowRefs.current.delete(entry.id);
                  }}
                  className={`trace-row ${selectedRow ? "selected" : ""} ${open ? "expanded" : ""}`}
                  data-trace-id={entry.id}
                  onFocus={() => setFocused(entry.id)}
                  onClick={(event) => {
                    if (event.target !== event.currentTarget && (event.target as HTMLElement).closest("button")) return;
                    select(entry.id);
                  }}
                  onKeyDown={(event) => {
                    if (event.target !== event.currentTarget || event.altKey || event.ctrlKey || event.metaKey) return;
                    const index = rows.findIndex((row) => row.node.id === entry.id);
                    if (!["ArrowDown", "ArrowUp", "ArrowRight", "ArrowLeft", "Enter", " "].includes(event.key)) return;
                    event.preventDefault();
                    if (event.key === "ArrowDown") {
                      const next = rows[index + 1];
                      if (next) focus(next.node.id);
                    } else if (event.key === "ArrowUp") {
                      const prev = rows[index - 1];
                      if (prev) focus(prev.node.id);
                    } else if (event.key === "ArrowRight") {
                      if (!open) toggle(entry.id);
                      else {
                        const child = rows[index + 1];
                        if (child && child.depth > depth) focus(child.node.id);
                      }
                    } else if (event.key === "ArrowLeft") {
                      if (open) toggle(entry.id);
                      else if (entry.parentId) focus(entry.parentId);
                    } else if (event.key === "Enter") select(entry.id);
                    else toggle(entry.id);
                  }}
                >
                  <button
                    type="button"
                    tabIndex={-1}
                    className="expand-button"
                    aria-label={`Expand event ${entry.id}`}
                    aria-expanded={open}
                    onClick={(event) => {
                      event.stopPropagation();
                      toggle(entry.id);
                    }}
                  >
                    {open ? <ChevronDownIcon /> : <ChevronRightIcon />}
                  </button>
                  <div className="trace-event">
                    <Glyph kind={entry.kind} />
                    <span className="row-title">
                      <strong>{eventName(entry.kind)}</strong>
                      <span title={historySummary(entry)}>
                        {historyRows ? historySummary(entry) : label(entry)}
                        {entry.summaryTruncated && historyRows ? " · truncated" : ""}
                      </span>
                    </span>
                    <code title={entry.id}>{entry.id.slice(0, 8)}</code>
                    {!matches.has(entry.id) && (
                      <span className="ancestor-badge">{selectedRow ? "selected outside filters" : "ancestor"}</span>
                    )}
                    {!historyRows && depth === 0 && entry.parentId && tree.nodes.has(entry.parentId) && (
                      <span className="ancestor-badge">recorded parent cycle</span>
                    )}
                  </div>
                  <div className="row-metrics">
                    {entry.status && <Status value={entry.status} />}
                    {entry.tokens !== undefined && (
                      <span title="Recorded assistant totalTokens">{count(entry.tokens)} tok</span>
                    )}
                    <time title={entry.timestamp}>{time(entry.timestamp)}</time>
                  </div>
                  {view === "timeline" && <TimelineMark range={range} logTime={entry.timestamp} />}
                </div>
                {open && disclosed.has(entry.id) && (
                  <div className="entry-expanded">
                    {active && <InlineEntry entry={entry} inspect={select} />}
                    {childCount > 0 && (
                      <span className="children-label">
                        {childCount} visible child {childCount === 1 ? "entry" : "entries"}
                      </span>
                    )}
                    {entry.parentId && !tree.nodes.has(entry.parentId) && (
                      <span className="children-label">Parent outside indexed data: {entry.parentId}</span>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
      <div className="trace-pagination">
        <span>
          {baseDepth
            ? `Absolute hierarchy level ${baseDepth + 1}+ · page-local indentation`
            : historyRows
              ? "Branch-scoped history · browser-only selection"
              : "Original parents retained · browser-only selection"}
        </span>
        <Flex gap="2" align="center">
          <Button size="1" variant="ghost" disabled={!offset} onClick={() => setOffset(Math.max(0, offset - 50))}>
            Previous
          </Button>
          <Text size="1">
            {rows.length ? offset + 1 : 0}–{Math.min(offset + 50, rows.length)} / {rows.length}
          </Text>
          <Button size="1" variant="ghost" disabled={offset + 50 >= rows.length} onClick={() => setOffset(offset + 50)}>
            Next
          </Button>
        </Flex>
      </div>
    </section>
  );
}
