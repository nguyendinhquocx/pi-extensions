import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";

// Variable-height virtualization. The top visible source ID anchors measurements and tail appends.
export function useVirtualContext(ids: string[]) {
  const scroller = useRef<HTMLElement>(null);
  const elements = useRef(new Map<string, HTMLDivElement>());
  const anchor = useRef<{ id: string; offset: number } | undefined>(undefined);
  const resetting = useRef(false);
  const [resetPending, setResetPending] = useState(false);
  const pendingFocus = useRef<string | undefined>(undefined);
  const [heights, measure] = useState(new Map<string, number>());
  const [range, setRange] = useState({ start: 0, end: 20 });
  const [viewport, setViewport] = useState({ start: 0, end: 0 });
  const positions = useMemo(() => {
    let top = 0;
    const rows = ids.map((id) => {
      const height = heights.get(id) ?? 52;
      const row = { id, top, height };
      top += height;
      return row;
    });
    return { rows, total: top };
  }, [ids, heights]);
  const current = useRef(positions);
  current.current = positions;
  const refresh = useCallback(() => {
    const node = scroller.current;
    if (!node) return;
    const rows = current.current.rows;
    const at = (top: number) => {
      let lo = 0;
      let hi = rows.length;
      while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        const row = rows[mid];
        if (row && row.top + row.height <= top) lo = mid + 1;
        else hi = mid;
      }
      return Math.min(lo, Math.max(0, rows.length - 1));
    };
    const index = at(node.scrollTop);
    const row = rows[index];
    if (!resetting.current) anchor.current = row ? { id: row.id, offset: node.scrollTop - row.top } : undefined;
    const visible = { start: index, end: Math.min(rows.length, at(node.scrollTop + node.clientHeight) + 1) };
    setViewport((old) => (old.start === visible.start && old.end === visible.end ? old : visible));
    const next = {
      start: Math.max(0, index - 5),
      end: Math.min(rows.length, at(node.scrollTop + node.clientHeight) + 6),
    };
    setRange((old) => (old.start === next.start && old.end === next.end ? old : next));
  }, []);
  useLayoutEffect(() => {
    const node = scroller.current;
    if (!node) return;
    const point = anchor.current;
    const row = point && positions.rows.find((item) => item.id === point.id);
    if (resetPending) {
      node.scrollTop = 0;
      anchor.current = undefined;
      resetting.current = false;
      setResetPending(false);
    } else if (row) node.scrollTop = row.top + point.offset;
    refresh();
  }, [positions, refresh, resetPending]);
  useLayoutEffect(() => {
    const valid = new Set(ids);
    measure((old) => {
      if ([...old.keys()].every((key) => valid.has(key))) return old;
      return new Map([...old].filter(([key]) => valid.has(key)));
    });
  }, [ids]);
  useLayoutEffect(() => {
    let disposed = false;
    const observer = new ResizeObserver((entries) => {
      if (disposed) return;
      const measured = entries.flatMap((entry) => {
        const id = (entry.target as HTMLElement).dataset.segmentId;
        if (!id) {
          refresh();
          return [];
        }
        const height = Math.ceil(entry.target.getBoundingClientRect().height);
        return height > 0 ? [{ id, height }] : [];
      });
      if (measured.length)
        measure((old) => {
          if (measured.every((item) => old.get(item.id) === item.height)) return old;
          const next = new Map(old);
          for (const item of measured) next.set(item.id, item.height);
          return next;
        });
    });
    if (scroller.current) observer.observe(scroller.current);
    for (const id of ids.slice(range.start, range.end)) {
      const element = elements.current.get(id);
      if (element) observer.observe(element);
    }
    const focused =
      pendingFocus.current && elements.current.get(pendingFocus.current)?.querySelector<HTMLElement>(".segment-row");
    if (focused) {
      focused.focus({ preventScroll: true });
      pendingFocus.current = undefined;
    }
    return () => {
      disposed = true;
      observer.disconnect();
    };
  }, [range.start, range.end, ids, refresh]);
  function jump(index: number, focus = false): void {
    const row = positions.rows[index];
    if (!row || !scroller.current) return;
    if (focus) {
      const element = elements.current.get(row.id)?.querySelector<HTMLElement>(".segment-row");
      if (element) element.focus({ preventScroll: true });
      else pendingFocus.current = row.id;
    }
    scroller.current.scrollTop = row.top;
    refresh();
  }
  const reset = useCallback(() => {
    resetting.current = true;
    setResetPending(true);
    if (scroller.current) scroller.current.scrollTop = 0;
    anchor.current = undefined;
    refresh();
  }, [refresh]);
  return {
    scroller,
    elements,
    positions: positions.rows,
    totalHeight: positions.total,
    range,
    viewport,
    refresh,
    jump,
    reset,
  };
}
