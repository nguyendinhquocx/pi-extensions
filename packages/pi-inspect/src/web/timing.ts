import type { Call, EntrySummary } from "../model.js";
export interface Axis {
  start: number;
  end: number;
}
export function timestamp(value: string): number | undefined {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}
export function axis(entries: EntrySummary[], calls: Call[]): Axis | undefined {
  const values = [
    ...entries.map((entry) => timestamp(entry.timestamp)),
    ...calls.flatMap((call) => [call.observedStartedAt, call.observedEndedAt]),
  ].filter((value): value is number => value !== undefined && Number.isFinite(value));
  return values.length ? { start: Math.min(...values), end: Math.max(...values) } : undefined;
}
export function position(value: number, range: Axis): number {
  return range.end === range.start ? 50 : ((value - range.start) / (range.end - range.start)) * 100;
}
export function interval(call: Call): { start: number; end: number } | undefined {
  const start = call.observedStartedAt;
  const end = call.observedEndedAt;
  return start !== undefined && end !== undefined && Number.isFinite(start) && Number.isFinite(end) && end >= start
    ? { start, end }
    : undefined;
}
