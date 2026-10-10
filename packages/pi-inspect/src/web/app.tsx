import { HamburgerMenuIcon, MoonIcon, ReaderIcon, SunIcon } from "@radix-ui/react-icons";
import { Badge, Callout, Heading, IconButton, Theme } from "@radix-ui/themes";
import { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "@radix-ui/themes/styles.css";
import "./style.css";
import "./composition.css";
import "./session.css";
import type { BranchView, ContextComposition as Composition, Snapshot } from "../model.js";
import { generation, headers, RequestFailure, request, useDetail } from "./api.js";
import { CapturedExecutions } from "./captured-executions.js";
import { ContextComposition } from "./context-composition.js";
import { ContextInventory } from "./context-inventory.js";
import { type Filters, matches } from "./format.js";
import { history, internalEntry } from "./history.js";
import { Inspector } from "./inspector.js";
import { Overview } from "./overview.js";
import { PaneDrawer, ResizeHandle, useNarrow } from "./panes.js";
import { boundedSearch, searchNeedle } from "./search.js";
import { SessionFilters } from "./session-filters.js";
import { Trace } from "./trace.js";

type Selection = { kind: "entry" | "call"; id: string; serial: number; filterVersion?: number; anchor?: string | null };
function App() {
  const [appearance, setAppearance] = useState<"dark" | "light">("light");
  const [revision, setRevision] = useState(-1);
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const [branch, setBranch] = useState<BranchView>();
  const [branchError, setBranchError] = useState("");
  const [branchAttempt, setBranchAttempt] = useState(0);
  const branchOwner = useRef<{ entryId: string; attempt: number } | undefined>(undefined);
  const [selection, setSelection] = useState<Selection>();
  const [view, setView] = useState("list");
  const [surface, setSurface] = useState("context");
  const [sessionView, setSessionView] = useState("history");
  const [historyLeaf, setHistoryLeaf] = useState<string | null>(null);
  const [showInternal, setShowInternal] = useState(false);
  const [preview, setPreview] = useState<Composition>();
  const [filters, setFilters] = useState<Filters>({
    query: "",
    kind: "all",
    groups: [],
    errorsOnly: false,
    slowOnly: false,
  });
  const [filterVersion, setFilterVersion] = useState(0);
  const filterEpoch = useRef(0);
  function changeFilters(value: Filters) {
    setFilters({ ...value, query: boundedSearch(value.query) });
    setFilterVersion(++filterEpoch.current);
  }
  const [error, setError] = useState("");
  const [connected, setConnected] = useState(false);
  const lifecycle = useRef<{ terminal: boolean; stream?: AbortController }>({ terminal: false });
  const [tab, setTab] = useState("content");
  const navTrigger = useRef<HTMLButtonElement>(null);
  const inspectorTrigger = useRef<HTMLButtonElement>(null);
  const [navOpen, setNavOpen] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [navDrawer, setNavDrawer] = useState(false);
  const [inspectorDrawer, setInspectorDrawer] = useState(false);
  const [navWidth, setNavWidth] = useState(() => Math.max(200, Math.min(360, window.innerWidth * 0.185)));
  const [inspectorWidth, setInspectorWidth] = useState(() => Math.max(280, Math.min(520, window.innerWidth * 0.235)));
  const narrow = useNarrow();
  const sideBudget = Math.max(0, window.innerWidth - 600);
  const navSize = navOpen ? Math.min(navWidth, inspectorOpen ? sideBudget * 0.4 : sideBudget) : 0;
  const inspectorSize = inspectorOpen ? Math.min(inspectorWidth, navOpen ? sideBudget * 0.6 : sideBudget) : 0;
  const calls = snapshot?.calls ?? [];
  const entries = snapshot?.nodes ?? [];
  const selectedCall =
    selection?.kind === "call" ? calls.find((call) => call.occurrenceId === selection.id) : undefined;
  const represented = useMemo(() => new Set(entries.map((entry) => entry.id)), [entries]);
  const callAnchorAvailable = Boolean(selectedCall?.branchAnchor && represented.has(selectedCall.branchAnchor));
  const entryId =
    selection?.kind === "entry" ? selection.id : callAnchorAvailable ? (selectedCall?.branchAnchor ?? "") : "";
  const paneActive =
    surface === "events" && revision >= 0 && (inspectorOpen || inspectorDrawer) && selection?.kind === "entry";
  const { detail, error: detailError, retry: retryDetails } = useDetail(paneActive ? entryId : undefined);
  const previousSelection = useRef<Selection | undefined>(undefined);
  useEffect(() => {
    if (sessionView === "executions" && previousSelection.current?.kind === "call" && selection?.kind === "entry")
      setSessionView("branches");
    previousSelection.current = selection;
  }, [selection, sessionView]);
  const selectedNode = entries.find((node) => node.id === entryId);
  const preparedFilters = useMemo(() => ({ ...filters, query: searchNeedle(filters.query) }), [filters]);
  const matching = useMemo(
    () => new Set(entries.filter((node) => matches(node, preparedFilters, calls)).map((node) => node.id)),
    [entries, calls, preparedFilters],
  );
  function selectEntry(id: string) {
    setSurface("events");
    if (sessionView === "executions") setSessionView("branches");
    if (narrow) setInspectorDrawer(true);
    else setInspectorOpen(true);
    setSelection((old) => ({ kind: "entry", id, serial: (old?.serial ?? 0) + 1, filterVersion }));
  }
  function selectCall(id: string) {
    if (narrow) setInspectorDrawer(true);
    else setInspectorOpen(true);
    setSelection((old) => ({
      kind: "call",
      id,
      serial: (old?.serial ?? 0) + 1,
      filterVersion,
      anchor: calls.find((call) => call.occurrenceId === id)?.branchAnchor,
    }));
    setSurface("events");
    setSessionView("executions");
    setTab("content");
  }
  useEffect(() => {
    const controller = new AbortController();
    let retry: ReturnType<typeof setTimeout> | undefined;
    let refresh: ReturnType<typeof setTimeout> | undefined;
    lifecycle.current.stream = controller;
    const stop = (message: string) => {
      lifecycle.current.terminal = true;
      setRevision(-1);
      controller.abort();
      clearTimeout(refresh);
      setConnected(false);
      setError(message);
    };
    const connect = async () => {
      try {
        const response = await fetch(`/api/events?generation=${encodeURIComponent(generation)}`, {
          headers: headers(),
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        if ([401, 403, 409, 410].includes(response.status)) {
          stop("Session expired or unauthorized; open the viewer again from Pi.");
          return;
        }
        if (!response.ok || !response.body) throw new Error("Transient viewer refusal");
        setConnected(true);
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        try {
          while (!controller.signal.aborted) {
            const { value, done } = await reader.read();
            if (done || controller.signal.aborted) break;
            buffer += decoder.decode(value, { stream: true });
            let end = buffer.indexOf("\n\n");
            while (end !== -1) {
              const frame = buffer.slice(0, end);
              buffer = buffer.slice(end + 2);
              const line = frame.split("\n").find((s) => s.startsWith("data: "));
              if (line) {
                const data = JSON.parse(line.slice(6)) as { protocol: number; generation: string; revision: number };
                if (data.protocol !== 1 || data.generation !== generation) {
                  stop("Session changed; open the viewer again from Pi.");
                  return;
                }
                if (!refresh)
                  refresh = setTimeout(() => {
                    refresh = undefined;
                    setRevision((previous) => previous + 1);
                  }, 50);
              }
              end = buffer.indexOf("\n\n");
            }
          }
        } finally {
          await reader.cancel().catch(() => {});
          reader.releaseLock();
        }
      } catch {
        /* Offline state is visible; reconnect uses a fresh snapshot, not stale replay. */
      }
      if (!controller.signal.aborted) {
        setConnected(false);
        retry = setTimeout(() => void connect(), 1000);
      }
    };
    void connect();
    return () => {
      controller.abort();
      clearTimeout(retry);
      clearTimeout(refresh);
    };
  }, []);

  useEffect(() => {
    if (revision < 0) return;
    const controller = new AbortController();
    let retry: ReturnType<typeof setTimeout> | undefined;
    const load = () => {
      if (lifecycle.current.terminal || controller.signal.aborted) return;
      void request<Snapshot>("snapshot", controller.signal)
        .then((value) => {
          if (controller.signal.aborted || lifecycle.current.terminal) return;
          setSnapshot(value);
          setError("");
          const represented = new Set(value.nodes.map((node) => node.id));
          const id = value.leafId && represented.has(value.leafId) ? value.leafId : value.nodes[0]?.id;
          setSelection((old) => {
            if (old?.kind === "call" && !value.calls.some((call) => call.occurrenceId === old.id)) {
              const fallback = old.anchor && represented.has(old.anchor) ? old.anchor : id;
              return fallback
                ? { kind: "entry", id: fallback, serial: old.serial + 1, filterVersion: filterEpoch.current }
                : undefined;
            }
            if (old?.kind === "entry" && !represented.has(old.id)) {
              return id ? { kind: "entry", id, serial: old.serial + 1, filterVersion: filterEpoch.current } : undefined;
            }
            return old ?? (id ? { kind: "entry", id, serial: 0 } : undefined);
          });
        })
        .catch((error) => {
          if (!controller.signal.aborted && !lifecycle.current.terminal) {
            setError(String(error.message));
            if (error instanceof RequestFailure && error.terminal) {
              lifecycle.current.terminal = true;
              lifecycle.current.stream?.abort();
              setConnected(false);
              setRevision(-1);
            } else retry = setTimeout(load, 1000);
          }
        });
    };
    load();
    return () => {
      controller.abort();
      clearTimeout(retry);
    };
  }, [revision]);
  useEffect(() => {
    setBranchError("");
    if (!entryId || !paneActive) {
      branchOwner.current = undefined;
      setBranch(undefined);
      return;
    }
    const controller = new AbortController();
    setBranch(undefined);
    const owner = { entryId, attempt: branchAttempt };
    branchOwner.current = owner;
    void request<BranchView>(`branch?leaf=${encodeURIComponent(entryId)}&offset=0`, controller.signal)
      .then((value) => {
        if (!controller.signal.aborted && branchOwner.current === owner) setBranch(value);
      })
      .catch(() => {
        if (!controller.signal.aborted && branchOwner.current === owner)
          setBranchError("Could not load selected branch context.");
      });
    return () => controller.abort();
  }, [entryId, branchAttempt, paneActive]);

  const scoped = useMemo(
    () => history(entries, historyLeaf ?? snapshot?.leafId ?? null),
    [entries, historyLeaf, snapshot?.leafId],
  );
  const historyRows = useMemo(
    () =>
      scoped.rows.filter(
        ({ node }) =>
          showInternal || !internalEntry(node) || (selection?.filterVersion === filterVersion && node.id === entryId),
      ),
    [scoped.rows, showInternal, selection?.filterVersion, filterVersion, entryId],
  );
  const visibleHistory = useMemo(() => new Set(historyRows.map(({ node }) => node.id)), [historyRows]);
  const hiddenMatches = scoped.rows.filter(
    ({ node }) => internalEntry(node) && matching.has(node.id) && !visibleHistory.has(node.id),
  ).length;
  const sidebar = <SessionFilters filters={filters} change={changeFilters} />;
  const selectedBranch = branch?.leafId === entryId ? branch : undefined;
  const inspector = (
    <Inspector
      selected={selection?.id ?? ""}
      node={selectedNode}
      detail={detail}
      detailError={detailError}
      retryDetails={retryDetails}
      call={selectedCall}
      branch={selectedBranch}
      branchError={branchOwner.current?.entryId === entryId ? branchError : ""}
      retryBranch={() => setBranchAttempt((attempt) => attempt + 1)}
      snapshot={snapshot}
      tab={tab}
      changeTab={setTab}
      select={selectEntry}
      selectCall={selectCall}
      preview={() => {
        if (selectedBranch?.context) {
          setPreview(selectedBranch.context);
          setSurface("context");
          setInspectorDrawer(false);
          setNavDrawer(false);
        }
      }}
    />
  );
  return (
    <Theme
      className="inspector-app"
      appearance={appearance}
      accentColor="blue"
      grayColor="slate"
      radius="medium"
      scaling="100%"
    >
      <header className="app-header">
        <div className="brand">
          <div className="brand-logo" aria-hidden="true">
            π
          </div>
          <Heading size="4">Pi Session Inspector</Heading>
        </div>
        <div className="header-context">
          <span title={snapshot?.nameTruncated ? "Session name truncated to 512 characters" : undefined}>
            {snapshot?.name ?? "Connecting"}
            {snapshot?.nameTruncated && " · truncated"}
          </span>
          <span title={snapshot?.sessionId}>
            Session: <strong>{typeof snapshot?.sessionId === "string" ? snapshot.sessionId.slice(0, 8) : "—"}</strong>
          </span>
        </div>
        <div className="header-actions">
          <fieldset className="surface-switch" aria-label="Inspection source">
            <button
              type="button"
              aria-pressed={surface === "context"}
              onClick={() => {
                setPreview(undefined);
                setSurface("context");
                setInspectorDrawer(false);
                setNavDrawer(false);
              }}
            >
              Context
            </button>
            <button type="button" aria-pressed={surface === "events"} onClick={() => setSurface("events")}>
              Session
            </button>
          </fieldset>
          <IconButton
            hidden={surface !== "events"}
            ref={navTrigger}
            aria-label="Toggle filters"
            aria-expanded={narrow ? navDrawer : navOpen}
            variant="ghost"
            onClick={() => (narrow ? setNavDrawer(!navDrawer) : setNavOpen(!navOpen))}
          >
            <HamburgerMenuIcon />
          </IconButton>
          <IconButton
            hidden={surface !== "events"}
            ref={inspectorTrigger}
            aria-label="Toggle details"
            aria-expanded={narrow ? inspectorDrawer : inspectorOpen}
            variant="ghost"
            onClick={() => (narrow ? setInspectorDrawer(!inspectorDrawer) : setInspectorOpen(!inspectorOpen))}
          >
            <ReaderIcon />
          </IconButton>
          <Badge color={connected ? "green" : "amber"}>{connected ? "Live" : "Disconnected"}</Badge>
          <Badge>Read-only</Badge>
          <IconButton
            aria-label="Toggle appearance"
            variant="ghost"
            onClick={() => setAppearance(appearance === "dark" ? "light" : "dark")}
          >
            {appearance === "dark" ? <SunIcon /> : <MoonIcon />}
          </IconButton>
        </div>
      </header>
      {(error || snapshot?.incomplete) && (
        <div className="app-notices">
          {error && (
            <Callout.Root color="red">
              <Callout.Text>{error}</Callout.Text>
            </Callout.Root>
          )}
          {snapshot?.incomplete && (
            <Callout.Root color="amber">
              <Callout.Text>Indexed data is incomplete; existing entry/capture limits apply.</Callout.Text>
            </Callout.Root>
          )}
        </div>
      )}
      <main
        className={`app-grid ${narrow ? "narrow-layout" : ""}`}
        style={
          narrow
            ? undefined
            : {
                gridTemplateColumns:
                  surface === "context"
                    ? "0px 0px minmax(0, 1fr) 0px 0px"
                    : `${navSize}px ${navOpen ? 6 : 0}px minmax(0, 1fr) ${inspectorOpen ? 6 : 0}px ${inspectorSize}px`,
              }
        }
      >
        {!narrow && surface === "events" && (
          <>
            <div className="side-slot nav-slot" hidden={!navOpen}>
              {sidebar}
            </div>
            {navOpen && (
              <ResizeHandle name="Resize filters" value={navWidth} change={setNavWidth} min={180} max={420} />
            )}
          </>
        )}
        <div className="center-column">
          <div className="context-surface" hidden={surface !== "context"}>
            <div className="observed-context" hidden={Boolean(preview)}>
              <ContextComposition context={snapshot?.context} payload={snapshot?.providerObservation} />
              <ContextInventory snapshot={snapshot} />
            </div>
            {preview && (
              <div className="preview-context">
                <div className="preview-heading">
                  <strong>Session-derived preview · leaf {preview.leafId}</strong>
                  <button type="button" onClick={() => setPreview(undefined)}>
                    Back to last observed context
                  </button>
                </div>
                <ContextComposition context={preview} preview />
              </div>
            )}
          </div>
          <div className="events-surface" hidden={surface !== "events"}>
            <Overview snapshot={snapshot} />
            <div className="session-toolbar">
              <fieldset className="view-switch" aria-label="Session navigation">
                {[
                  ["history", "History"],
                  ["branches", "Branch view"],
                  ["executions", "Captured executions"],
                ].map(([value, label]) => (
                  <button
                    type="button"
                    key={value}
                    aria-pressed={sessionView === value}
                    onClick={() => setSessionView(value ?? "history")}
                  >
                    {label}
                    {value === "executions"
                      ? ` · ${calls.filter((call) => call.status === "running").length} running · ${calls.filter((call) => call.status === "error").length} errors`
                      : ""}
                  </button>
                ))}
              </fieldset>
              {sessionView === "history" && (
                <>
                  <span>Branch leaf: {historyLeaf ?? snapshot?.leafId ?? "unavailable"}</span>
                  <label>
                    <input
                      type="checkbox"
                      checked={showInternal}
                      onChange={(event) => setShowInternal(event.target.checked)}
                    />{" "}
                    Show internal events
                  </label>
                  {!showInternal && <span>{hiddenMatches} matching internal events hidden</span>}
                  {historyLeaf && (
                    <button type="button" onClick={() => setHistoryLeaf(null)}>
                      Follow active branch
                    </button>
                  )}
                  {scoped.issue && <span role="status">{scoped.issue}</span>}
                  {entryId && !scoped.rows.some(({ node }) => node.id === entryId) && (
                    <span role="status">Selected entry is outside this branch; use Branch view to locate it.</span>
                  )}
                </>
              )}
              {sessionView === "branches" && entryId && (
                <button
                  type="button"
                  onClick={() => {
                    setHistoryLeaf(entryId);
                    setSessionView("history");
                  }}
                >
                  History at selected entry
                </button>
              )}
            </div>
            <div className="session-primary" hidden={sessionView !== "history"}>
              <Trace
                entries={entries}
                matches={matching}
                selected={entryId}
                serial={selection?.serial ?? 0}
                revealSelected={selection?.filterVersion === filterVersion}
                select={selectEntry}
                view={view}
                changeView={setView}
                calls={calls}
                historyRows={historyRows}
                active={surface === "events" && sessionView === "history" && revision >= 0}
              />
            </div>
            <div className="session-primary" hidden={sessionView !== "branches"}>
              <Trace
                entries={entries}
                matches={matching}
                selected={entryId}
                serial={selection?.serial ?? 0}
                revealSelected={selection?.filterVersion === filterVersion}
                select={selectEntry}
                view={view}
                changeView={setView}
                calls={calls}
                active={surface === "events" && sessionView === "branches" && revision >= 0}
              />
            </div>
            <div className="session-primary execution-primary" hidden={sessionView !== "executions"}>
              <CapturedExecutions
                entries={entries}
                calls={calls}
                selected={selectedCall?.occurrenceId}
                select={selectCall}
                open={surface === "events" && sessionView === "executions"}
                view={view}
                changeView={setView}
                dropped={snapshot?.droppedCalls ?? 0}
                invalidEvents={snapshot?.invalidCallEvents ?? 0}
                filters={filters}
                revealSelected={selection?.filterVersion === filterVersion}
              />
            </div>
          </div>
        </div>
        {!narrow && surface === "events" && (
          <>
            {inspectorOpen ? (
              <ResizeHandle
                name="Resize details"
                value={inspectorWidth}
                change={setInspectorWidth}
                min={260}
                max={600}
                inverse
              />
            ) : null}
            <div className="side-slot inspector-slot" hidden={!inspectorOpen}>
              {inspector}
            </div>
          </>
        )}
      </main>
      {narrow && surface === "events" && (
        <>
          <PaneDrawer trigger={navTrigger} name="Session filters" side="left" open={navDrawer} change={setNavDrawer}>
            {sidebar}
          </PaneDrawer>
          <PaneDrawer
            trigger={inspectorTrigger}
            name="Details"
            side="right"
            open={inspectorDrawer}
            change={setInspectorDrawer}
          >
            {inspector}
          </PaneDrawer>
        </>
      )}
      <footer className="app-footer">
        <span>{connected ? "Connected · observing live events" : "Disconnected · reopen from Pi"}</span>
        <span>Read-only · bounded display copies · no provider transport spans</span>
      </footer>
    </Theme>
  );
}
const root = document.getElementById("root");
if (root) createRoot(root).render(<App />);
