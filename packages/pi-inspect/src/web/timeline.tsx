import type { Call } from "../model.js";
import { type Axis, interval, position, timestamp } from "./timing.js";

export function TimelineMark({ range, logTime, call }: { range?: Axis; logTime?: string; call?: Call }) {
  if (!range) return <span className="timing-unavailable">—</span>;
  const span = call ? interval(call) : undefined;
  const point = logTime === undefined ? (call?.observedStartedAt ?? call?.observedEndedAt) : timestamp(logTime);
  if (span && span.end > span.start)
    return (
      <span
        className="timeline-track"
        title={`Observed callback interval: ${new Date(span.start).toISOString()} → ${new Date(span.end).toISOString()} (${span.end - span.start}ms). Not provider transport timing.`}
      >
        <span
          className="timeline-span"
          style={{
            left: `${position(span.start, range)}%`,
            width: `${position(span.end, range) - position(span.start, range)}%`,
          }}
        />
      </span>
    );
  return point === undefined ? (
    <span className="timing-unavailable">—</span>
  ) : (
    <span
      className="timeline-track"
      title={`${logTime === undefined ? "Observed lifecycle point" : "Session log timestamp"}: ${new Date(point).toISOString()}`}
    >
      <span className="timeline-point" style={{ left: `${position(point, range)}%` }} />
    </span>
  );
}
