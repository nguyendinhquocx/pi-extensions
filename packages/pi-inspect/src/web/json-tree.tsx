import { useState } from "react";
import type { Json } from "../model.js";

const scopes = new Map<string, Map<string, boolean>>();
function JsonNode({
  value,
  name,
  path,
  state,
  root = false,
}: {
  value: Json;
  name: string;
  path: string;
  state: Map<string, boolean>;
  root?: boolean;
}) {
  const [open, setOpen] = useState(() => state.get(path) ?? root);
  const structured = value !== null && typeof value === "object";
  if (!structured)
    return (
      <div className="json-leaf">
        <span className="json-key">{name}</span>:{" "}
        <span className={typeof value === "string" ? "json-string" : "json-number"}>{JSON.stringify(value)}</span>
      </div>
    );
  const entries = Object.entries(value);
  return (
    <details
      className="json-object"
      open={open}
      onToggle={(event) => {
        state.set(path, event.currentTarget.open);
        setOpen(event.currentTarget.open);
      }}
    >
      <summary>
        <span className="json-key">{name}</span>{" "}
        <span className="json-summary">
          {Array.isArray(value) ? `[${entries.length} items]` : `{${entries.length} fields}`}
        </span>
      </summary>
      {
        <div className="json-children">
          {entries.map(([key, child]) => (
            <JsonNode
              key={key}
              value={child}
              name={key}
              state={state}
              path={`${path}/${key.replaceAll("~", "~0").replaceAll("/", "~1")}`}
            />
          ))}
        </div>
      }
    </details>
  );
}
export function JsonTree({ value, scope }: { value: Json; scope: string }) {
  let state = scopes.get(scope);
  if (!state) {
    state = new Map();
    scopes.set(scope, state);
    if (scopes.size > 128) {
      const first = scopes.keys().next().value;
      if (first !== undefined) scopes.delete(first);
    }
  }
  return (
    <fieldset className="json-tree" aria-label="Structured display data">
      <JsonNode key={scope} value={value} name="$" path="$" state={state} root />
    </fieldset>
  );
}
