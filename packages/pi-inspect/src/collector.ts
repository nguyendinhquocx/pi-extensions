import type {
  ToolExecutionEndEvent,
  ToolExecutionStartEvent,
  ToolExecutionUpdateEvent,
} from "@earendil-works/pi-coding-agent";
import type { Call } from "./model.js";
import { capture, displayText } from "./privacy.js";

function validIdentity(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 512;
}

export class Collector {
  readonly startedAt = Date.now();
  private calls = new Map<string, Call>();
  private partialAt = new Map<string, number>();
  private sequence = 0;
  dropped = 0;
  invalidEvents = 0;
  private admit(event: { toolCallId: string; toolName: string }): boolean {
    if (validIdentity(event.toolCallId) && validIdentity(event.toolName)) return true;
    this.invalidEvents++;
    return false;
  }
  private fenceParent(call: Call, parent: unknown): boolean {
    if (parent !== undefined && !validIdentity(parent)) {
      const changed =
        call.parentUnavailable !== "Invalid or over-budget parent ID; relationship unavailable" ||
        call.parentOccurrenceId !== undefined;
      call.parentId = undefined;
      call.parentOccurrenceId = undefined;
      call.parentUnavailable = "Invalid or over-budget parent ID; relationship unavailable";
      return changed;
    }
    return false;
  }
  constructor(private readonly maxCalls = 128) {}
  private create(
    event: { toolCallId: string; parentToolCallId?: string; toolName: string },
    args: unknown,
    anchor: string | null,
  ): Call {
    const parentId = validIdentity(event.parentToolCallId) ? event.parentToolCallId : undefined;
    const parent = parentId ? this.active(parentId) : undefined;
    const ambiguousParent =
      event.parentToolCallId !== undefined &&
      this.list().filter((item) => item.id === event.parentToolCallId && item.status === "running").length > 1;
    const call: Call = {
      id: event.toolCallId,
      occurrenceId: `call-${++this.sequence}`,
      parentId,
      parentUnavailable: ambiguousParent ? "Overlapping running parent IDs; relationship unavailable" : undefined,
      parentOccurrenceId: parent?.status === "running" ? parent.occurrenceId : undefined,
      name: displayText(event.toolName),
      status: "running",
      args: capture(args, 8192),
      branchAnchor: parent?.status === "running" ? parent.branchAnchor : validIdentity(anchor) ? anchor : null,
      correlationUnavailable: anchor !== null && !validIdentity(anchor) ? true : undefined,
    };
    this.fenceParent(call, event.parentToolCallId);
    this.calls.set(call.occurrenceId, call);
    while (this.calls.size > this.maxCalls) {
      const first = this.calls.keys().next().value;
      if (first === undefined) break;
      this.calls.delete(first);
      this.partialAt.delete(first);
      this.dropped++;
    }
    return call;
  }
  private active(rawId: string): Call | undefined {
    const running = this.list().filter((call) => call.id === rawId && call.status === "running");
    if (running.length > 1) {
      for (const call of running) call.correlationUnavailable = true;
      return undefined;
    }
    return running[0];
  }
  start(event: ToolExecutionStartEvent, anchor: string | null): void {
    if (!this.admit(event)) return;
    const now = Date.now();
    const call = this.create(event, event.args, anchor);
    call.observedStartedAt = now;
    if (
      this.list().filter((parent) => parent.id === call.id && parent.branchAnchor === call.branchAnchor).length === 1
    ) {
      for (const child of this.calls.values())
        if (
          child.parentId === call.id &&
          !child.parentOccurrenceId &&
          !child.parentUnavailable &&
          child.status === "running" &&
          child.branchAnchor === call.branchAnchor
        )
          child.parentOccurrenceId = call.occurrenceId;
    }
    const occurrences = this.list().filter((item) => item.id === call.id && item.branchAnchor === call.branchAnchor);
    if (occurrences.length > 1) {
      for (const occurrence of occurrences) occurrence.correlationUnavailable = true;
      for (let i = 0; i < this.calls.size; i++)
        for (const child of this.calls.values())
          if (child.parentOccurrenceId && this.calls.get(child.parentOccurrenceId)?.correlationUnavailable)
            child.correlationUnavailable = true;
    }
    this.active(event.toolCallId); // Explicitly mark overlapping reused IDs as ambiguous, never misroute their results.
  }
  update(event: ToolExecutionUpdateEvent, anchor: string | null): boolean {
    if (!this.admit(event)) return true; // Publish the new unavailable-event counter.
    const now = Date.now();
    let call = this.active(event.toolCallId);
    if (!call && this.list().some((call) => call.id === event.toolCallId && call.status === "running")) return false;
    call ??= this.create(event, event.args, anchor);
    const parentChanged = this.fenceParent(call, event.parentToolCallId);
    if (now - (this.partialAt.get(call.occurrenceId) ?? -Infinity) < 250) return parentChanged;
    this.partialAt.set(call.occurrenceId, now);
    call.result = capture(event.partialResult);
    return true;
  }
  end(event: ToolExecutionEndEvent, anchor: string | null): void {
    if (!this.admit(event)) return;
    const now = Date.now();
    const running = this.list().filter((call) => call.id === event.toolCallId && call.status === "running");
    const call = this.active(event.toolCallId) ?? this.create(event, "[not captured]", anchor);
    if (running.length > 1) {
      call.correlationUnavailable = true;
      call.parentOccurrenceId = undefined;
    }
    this.fenceParent(call, event.parentToolCallId);
    call.status = event.isError ? "error" : "ok";
    call.durationMs =
      typeof event.durationMs === "number" && Number.isFinite(event.durationMs) && event.durationMs >= 0
        ? event.durationMs
        : undefined;
    call.observedEndedAt = now;
    call.result = capture(event.result);
  }
  settle(): void {
    for (const call of this.calls.values()) if (call.status === "running") call.status = "unfinished";
  }
  list(): Call[] {
    return [...this.calls.values()];
  }
}
