import type {
  AgentEvent,
  EntryId,
  EntryRecord,
  SnapshotEvent,
  SubmissionId,
  SubmissionRecord,
} from "@earendil-works/pi-durable";
import { durableAttributes, durableContent, durableDiagnosticCount, durableUsage } from "./durable-projection.js";
import { sanitizeTraceValue } from "./sanitizer.js";
import type { Observation, ObservationAttributes, ObservationType, TraceBackend } from "./tracing.js";

export interface DurableCorrelation {
  requestId?: string;
  userId?: string;
  applicationId?: string;
}

export interface DurableRecorderOptions extends DurableCorrelation {
  conversationId: number;
  sessionId?: string;
  traceName?: string;
  captureContent?: boolean;
  metadata?: Readonly<Record<string, unknown>>;
  submissionCorrelation?: (record: SubmissionRecord) => DurableCorrelation;
  onTraceId?: (traceId: string) => void | Promise<void>;
  onError?: (stage: string) => void | Promise<void>;
}

const SAFE_UNANSWERED_REASONS = new Set([
  "aborted",
  "model_error",
  "no_model",
  "reset",
  "stale",
  "faulted",
  "missing_task",
  "task_too_old",
  "migration_failed",
]);

interface Span {
  observation?: Observation;
  ended: boolean;
}
interface SubmissionSpan {
  span: Span;
  correlation: DurableCorrelation;
  terminal: boolean;
}
interface RunSpan {
  span: Span;
  primary: SubmissionId;
  inputs: readonly SubmissionId[];
  correlation: DurableCorrelation;
  round: number;
  generation?: Span;
  tools: Map<string, Span>;
  completedTools: Set<string>;
}

/** Durable state machine using the same trace backend, ownership and capture core as the Pi adapter. */
export class DurableRecorder {
  private readonly root: Span;
  private run?: RunSpan;
  private readonly submissions = new Map<SubmissionId, SubmissionSpan>();
  private readonly pendingSubmissions = new Set<SubmissionId>();
  private readonly entries = new Set<number>();
  private readonly completedRuns = new Set<SubmissionId>();
  private disposed = false;
  private gaps = 0;

  constructor(
    private readonly backend: TraceBackend,
    private readonly options: DurableRecorderOptions,
  ) {
    this.root = this.start(options.traceName ?? "pi.durable.conversation", "agent", undefined, {
      metadata: {
        ...this.customMetadata(),
        "pi.runtime": "durable",
        "pi.durable.schema_version": "1",
        "pi.durable.conversation_id": options.conversationId,
        ...(options.applicationId ? { "pi.application.id": options.applicationId } : {}),
      },
    });
    this.safe(() => {
      this.root.observation?.updateTrace?.(
        durableAttributes({
          name: options.traceName ?? "pi.durable.conversation",
          sessionId: options.sessionId ?? String(options.conversationId),
          ...(options.userId ? { userId: options.userId } : {}),
          metadata: this.customMetadata(),
          version: "durable-1",
        }),
      );
    });
    const traceId = this.root.observation?.traceId;
    if (traceId) this.callback("trace-id callback", () => options.onTraceId?.(traceId));
  }

  get submissionIds(): readonly SubmissionId[] {
    return [...this.pendingSubmissions];
  }

  report(stage: string): void {
    this.callback("error callback", () => this.options.onError?.(stage), false);
  }

  private callback(stage: string, action: () => void | Promise<void>, report = true): void {
    try {
      Promise.resolve(action()).catch(() => {
        if (report) this.report(stage);
      });
    } catch {
      if (report) this.report(stage);
    }
  }

  private customMetadata(): Record<string, unknown> {
    const value = sanitizeTraceValue(this.options.metadata, true);
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return Object.fromEntries(Object.entries(value).filter(([key]) => !key.startsWith("pi.")));
  }

  private safe(action: () => void): void {
    try {
      action();
    } catch {
      this.report("exporter observation");
    }
  }

  private start(name: string, type: ObservationType, parent?: Span, attributes: ObservationAttributes = {}): Span {
    if (this.disposed || (parent && (parent.ended || !parent.observation))) return { ended: true };
    const span: Span = { ended: false };
    const inherited = parent === this.run?.span ? this.correlationAttributes(this.run?.correlation ?? {}) : {};
    this.safe(() => {
      span.observation = this.backend.start(
        String(sanitizeTraceValue(name, true)),
        durableAttributes({
          version: "durable-1",
          sessionId: this.options.sessionId ?? String(this.options.conversationId),
          ...(this.options.userId ? { userId: this.options.userId } : {}),
          ...inherited,
          ...attributes,
          metadata: { ...inherited.metadata, ...attributes.metadata },
        }),
        { asType: type, parent: parent?.observation },
      );
    });
    // A missing parent handle must never become a new exporter root for descendants.
    if (!span.observation) span.ended = true;
    if (this.disposed) this.interrupted(span, "Observer disposed during exporter start.");
    return span;
  }

  private update(span: Span, attributes: ObservationAttributes): void {
    if (!span.ended)
      this.safe(() => {
        span.observation?.update(durableAttributes(attributes));
      });
  }

  private end(span: Span | undefined, attributes: ObservationAttributes = {}): void {
    if (!span || span.ended) return;
    span.ended = true;
    const observation = span.observation;
    // Release ended SDK handles/payloads, and claim the end before any callback can reenter disposal.
    span.observation = undefined;
    this.safe(() => {
      observation?.update(durableAttributes(attributes));
    });
    this.safe(() => {
      observation?.end();
    });
  }

  private interrupted(span: Span | undefined, reason: string): void {
    this.end(span, {
      level: "WARNING",
      statusMessage: reason,
      metadata: { "pi.durable.outcome": "observation_interrupted" },
    });
  }

  private correlationAttributes(correlation: DurableCorrelation): ObservationAttributes {
    return {
      metadata: {
        ...(correlation.userId ? { "pi.user.id": correlation.userId } : {}),
        ...(correlation.requestId ? { "pi.request.id": correlation.requestId } : {}),
        ...(correlation.applicationId ? { "pi.application.id": correlation.applicationId } : {}),
      },
    };
  }

  async submission(
    record: SubmissionRecord,
    readEntry: (id: EntryId) => Promise<EntryRecord | undefined>,
    correlation?: DurableCorrelation,
    snapshot = false,
  ): Promise<void> {
    if (this.disposed || record.conversationId !== this.options.conversationId) return;
    let state = this.submissions.get(record.id);
    if (!state) {
      let host: DurableCorrelation = {};
      try {
        host = this.options.submissionCorrelation?.(record) ?? {};
      } catch {
        this.report("submission correlation");
      }
      if (this.disposed) return;
      const ids = sanitizeTraceValue(
        {
          requestId: record.requestId,
          userId: this.options.userId,
          applicationId: this.options.applicationId,
          ...host,
          ...correlation,
        },
        true,
      ) as DurableCorrelation;
      state = {
        span: this.start("pi.durable.submission", "span", this.root, {
          ...this.correlationAttributes(ids),
          metadata: {
            ...this.correlationAttributes(ids).metadata,
            "pi.durable.submission_id": record.id,
            "pi.durable.submission_type": record.type,
            "pi.durable.snapshot_observation": snapshot,
          },
        }),
        correlation: ids,
        terminal: false,
      };
      if (this.disposed) return;
      this.submissions.set(record.id, state);
      this.pendingSubmissions.add(record.id);
    }
    if (state.terminal) return;
    // Status reads can be newer than the run snapshot. Only ordered placement events extend membership.
    if (!snapshot && record.status === "placed" && this.run && !this.run.inputs.includes(record.id)) {
      this.run.inputs = [...this.run.inputs, record.id];
      this.update(this.run.span, { metadata: { "pi.durable.inputs": this.run.inputs } });
    }
    if (correlation) {
      state.correlation = sanitizeTraceValue({ ...state.correlation, ...correlation }, true) as DurableCorrelation;
      this.update(state.span, this.correlationAttributes(state.correlation));
    }
    const run = this.run;
    if (run?.primary === record.id) {
      run.correlation = state.correlation;
      const attributes = this.correlationAttributes(state.correlation);
      this.update(run.span, attributes);
      if (run.generation) this.update(run.generation, attributes);
      for (const tool of run.tools.values()) this.update(tool, attributes);
    }
    this.update(state.span, { metadata: { "pi.durable.submission_status": record.status } });
    if (record.entry !== undefined && record.type === "input") {
      const entry = await readEntry(record.entry);
      if (this.disposed || state.terminal) return;
      this.update(state.span, { input: durableContent(entry?.model, this.options.captureContent ?? true) });
    }
    if (record.status === "done" || record.status === "unanswered") {
      let output: unknown;
      if (record.status === "done" && record.type === "input") {
        const entry = await readEntry(record.answer);
        if (this.disposed || state.terminal) return;
        // The answer ID is authoritative; no streamed fragments or last intermediate assistant inference.
        output = durableContent(entry?.model, this.options.captureContent ?? true);
      }
      const reason =
        record.status === "unanswered" && SAFE_UNANSWERED_REASONS.has(record.reason) ? record.reason : undefined;
      state.terminal = true;
      this.pendingSubmissions.delete(record.id);
      this.end(state.span, {
        ...(output !== undefined ? { output } : {}),
        level:
          record.status === "done"
            ? "DEFAULT"
            : reason === "model_error" || reason === "no_model" || reason === "faulted"
              ? "ERROR"
              : "WARNING",
        // Only known structural reason codes are safe; arbitrary reason/detail can contain provider secrets.
        metadata: {
          "pi.durable.submission_status": record.status,
          "pi.durable.answer_entry_id": record.answer,
          ...(record.status === "unanswered" ? { "pi.durable.unanswered_reason": reason ?? "unknown" } : {}),
        },
      });
    }
  }

  snapshot(snapshot: SnapshotEvent, initial = false): void {
    if (this.disposed) return;
    for (const entry of snapshot.entries) this.entries.add(entry.id);
    if (!initial) {
      this.gaps += 1;
      this.update(this.root, {
        metadata: { "pi.durable.resync_count": this.gaps, "pi.durable.history_complete": false },
      });
    } else
      this.update(this.root, {
        metadata: { "pi.durable.history_complete": false, "pi.durable.attachment": "snapshot" },
      });
    const primary = snapshot.run?.inputs[0];
    if (this.run && this.run.primary !== primary)
      this.closeRun("Run boundary not observed; snapshot replaced the observation.");
    if (this.run) this.closeRound("Snapshot replaced generation/tool observation; activity may have been missed.");
    if (snapshot.run) {
      this.beginRun(snapshot.run.inputs, true);
      // Do not turn snapshot transcript/partials/tools into historical starts or completions.
      if (this.run) this.update(this.run.span, { metadata: { "pi.durable.observation_incomplete": true } });
    }
  }

  private beginRun(inputs: readonly SubmissionId[], snapshot = false): void {
    const primary = inputs[0];
    if (primary === undefined || this.completedRuns.has(primary)) return;
    if (this.run?.primary === primary) {
      this.run.inputs = [...inputs];
      this.update(this.run.span, { metadata: { "pi.durable.inputs": this.run.inputs } });
      return;
    }
    if (this.run) this.closeRun("Unexpected run replacement.");
    const correlation = this.submissions.get(primary)?.correlation ?? {};
    this.run = {
      span: this.start("pi.durable.run", "agent", this.root, {
        ...this.correlationAttributes(correlation),
        metadata: {
          ...this.correlationAttributes(correlation).metadata,
          "pi.durable.primary_submission_id": primary,
          "pi.durable.inputs": [...inputs],
          "pi.durable.snapshot_observation": snapshot,
        },
      }),
      primary,
      inputs: [...inputs],
      correlation,
      round: 0,
      tools: new Map(),
      completedTools: new Set(),
    };
  }

  private closeRound(reason: string): void {
    const run = this.run;
    if (!run) return;
    this.interrupted(run.generation, reason);
    run.generation = undefined;
    for (const tool of run.tools.values()) this.interrupted(tool, reason);
    run.tools.clear();
  }

  private closeRun(reason?: string): void {
    const run = this.run;
    if (!run) return;
    this.closeRound(reason ?? "Run ended without an observed descendant completion.");
    this.end(
      run.span,
      reason
        ? { level: "WARNING", statusMessage: reason, metadata: { "pi.durable.observation_incomplete": true } }
        : {},
    );
    this.completedRuns.add(run.primary);
    this.run = undefined;
  }

  private generation(): Span | undefined {
    const run = this.run;
    if (!run) return undefined;
    if (!run.generation) {
      run.round += 1;
      run.generation = this.start("pi.durable.llm", "generation", run.span, {
        metadata: { "pi.durable.observed_generation_index": run.round },
      });
    }
    return run.generation;
  }

  event(event: AgentEvent): void {
    if (this.disposed) return;
    switch (event.type) {
      case "run_start":
        this.beginRun(event.inputs);
        break;
      case "run_end":
        if (this.run?.primary === event.inputs[0]) this.closeRun();
        break;
      case "message_start":
        if (event.message.role === "assistant") this.generation();
        break;
      case "message_end": {
        const entry = event.entry;
        if (this.entries.has(entry.id)) break;
        this.entries.add(entry.id);
        const message = entry.model?.[0];
        if (message?.role !== "assistant") break;
        const generation = this.generation();
        if (!generation) break;
        this.end(generation, {
          output: durableContent(entry.model, this.options.captureContent ?? true),
          model: message.model,
          ...durableUsage(message),
          level: message.stopReason === "error" ? "ERROR" : message.stopReason === "aborted" ? "WARNING" : "DEFAULT",
          metadata: {
            "pi.durable.entry_id": entry.id,
            "pi.durable.task_id": entry.byTaskId,
            "pi.durable.stop_reason": message.stopReason,
            "pi.durable.provider": message.provider,
          },
        });
        if (this.run) this.run.generation = undefined;
        break;
      }
      case "tool_execution_start": {
        if (
          !this.run ||
          this.run.tools.has(event.toolCallId) ||
          this.run.completedTools.has(`${this.run.round}:${event.toolCallId}`)
        )
          break;
        this.run.tools.set(
          event.toolCallId,
          this.start("pi.durable.tool", "tool", this.run.span, {
            input:
              this.options.captureContent === false
                ? "[content capture disabled]"
                : sanitizeTraceValue(event.args, true),
            metadata: {
              "pi.durable.tool_call_id": event.toolCallId,
              "pi.durable.tool_name": sanitizeTraceValue(event.toolName),
              "pi.durable.observed_generation_index": this.run.round,
            },
          }),
        );
        break;
      }
      case "tool_execution_end": {
        const run = this.run;
        if (!run) break;
        const key = `${run.round}:${event.toolCallId}`;
        if (run.completedTools.has(key) || (event.entry && this.entries.has(event.entry.id))) break;
        run.completedTools.add(key);
        if (event.entry) this.entries.add(event.entry.id);
        const tool =
          run.tools.get(event.toolCallId) ??
          this.start("pi.durable.tool", "tool", run.span, {
            metadata: { "pi.durable.start_not_observed": true, "pi.durable.tool_call_id": event.toolCallId },
          });
        const message = event.entry?.model?.[0];
        this.end(tool, {
          output: durableContent(
            event.entry?.model,
            this.options.captureContent ?? true,
            durableDiagnosticCount(event.entry),
          ),
          ...(message ? durableUsage(message) : {}),
          level: message?.role === "toolResult" && message.isError ? "ERROR" : event.entry ? "DEFAULT" : "WARNING",
          metadata: { "pi.durable.result_entry_id": event.entry?.id, "pi.durable.result_missing": !event.entry },
        });
        run.tools.delete(event.toolCallId);
        break;
      }
      case "auto_retry_start":
        this.end(this.run?.generation, {
          level: "ERROR",
          statusMessage: "Provider attempt will retry.",
          metadata: { "pi.durable.retry_attempt": event.attempt },
        });
        if (this.run) this.run.generation = undefined;
        break;
      case "task_failed":
        if (this.run)
          this.update(this.run.span, { level: "ERROR", metadata: { "pi.durable.failed_task_id": event.taskId } });
        break;
      // turn_end is a round boundary, never a submission boundary. Deltas and arbitrary diagnostics are not captured.
      default:
        break;
    }
  }

  dispose(reason = "Tracing observer disposed; execution outcome is unknown."): void {
    if (this.disposed) return;
    this.disposed = true;
    this.closeRun(reason);
    for (const state of this.submissions.values()) if (!state.terminal) this.interrupted(state.span, reason);
    this.end(this.root, { metadata: { "pi.durable.resync_count": this.gaps } });
    this.submissions.clear();
    this.pendingSubmissions.clear();
    this.entries.clear();
    this.completedRuns.clear();
  }
}
