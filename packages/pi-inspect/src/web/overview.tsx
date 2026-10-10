import type { Snapshot } from "../model.js";
import { Data } from "./components.js";
import { count, duration } from "./format.js";
import { timestamp } from "./timing.js";

export function Overview({ snapshot }: { snapshot?: Snapshot }) {
  const nodes = snapshot?.nodes ?? [];
  const stamps = nodes.map((node) => timestamp(node.timestamp)).filter((value): value is number => value !== undefined);
  const tokens = nodes.filter((node) => node.tokens !== undefined);
  const partial = (snapshot?.totalEntries ?? 0) > nodes.length;
  const metrics = [
    ["Entries", count(snapshot?.totalEntries), "All persisted entries, across branches."],
    [
      "Recorded span",
      duration(stamps.length ? Math.max(...stamps) - Math.min(...stamps) : undefined),
      "Indexed log timestamp range, not execution duration.",
    ],
    [
      "Model messages",
      snapshot ? `${nodes.filter((node) => node.kind === "assistant").length}${partial ? "+" : ""}` : "—",
      "Assistant messages, not provider request count.",
    ],
    ["Captured calls", count(snapshot?.calls.length), "Bounded live records since consent."],
    [
      "Tokens",
      tokens.length ? `${count(tokens.reduce((sum, node) => sum + (node.tokens ?? 0), 0))}${partial ? "+" : ""}` : "—",
      "Persisted assistant totalTokens; excludes auxiliary usage.",
    ],
    [
      "Log errors",
      snapshot ? `${nodes.filter((node) => node.status === "error").length}${partial ? "+" : ""}` : "—",
      "Indexed recorded error entries; live errors are separate.",
    ],
  ];
  return (
    <section className="overview" aria-label="Session overview">
      <div className="overview-metrics">
        {metrics.map(([name, value, hint]) => (
          <div className="metric" key={name} title={hint}>
            <span>{name}</span>
            <strong>{value}</strong>
          </div>
        ))}
      </div>
      {Boolean(snapshot?.invalidEntryCount) && (
        <details className="invalid-entries">
          <summary>
            {snapshot?.invalidEntryCount} invalid or ambiguous entries omitted from navigation; bounded raw evidence
          </summary>
          <Data
            label="Invalid or ambiguous entry evidence · up to 20 indexed records"
            data={{
              value: (snapshot?.invalidEntries ?? []).map((item) => ({
                index: item.index,
                reason: item.reason,
                raw: item.raw.value,
                truncated: item.raw.truncated,
              })),
              truncated: (snapshot?.invalidEntryCount ?? 0) > 20,
            }}
            scope="invalid-identities"
          />
        </details>
      )}
    </section>
  );
}
