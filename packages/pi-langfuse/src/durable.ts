import type { Context } from "@earendil-works/chord";
import { withCancel } from "@earendil-works/chord/context";
import {
  type AgentEventStream,
  type ConversationId,
  type EntryId,
  type Harness,
  type SubmissionId,
  watchEvents,
} from "@earendil-works/pi-durable";
import { type DurableCorrelation, DurableRecorder, type DurableRecorderOptions } from "./durable-recorder.js";
import { getLangfuseRuntimeInternal, type LangfuseRuntime } from "./runtime-core.js";

export type { DurableCorrelation } from "./durable-recorder.js";
export {
  type CreateLangfuseRuntimeOptions,
  createLangfuseRuntime,
  type LangfuseRuntime,
  type LangfuseRuntimeConfig,
} from "./runtime-api.js";
export { createLangfuseRuntimeFromBackend } from "./runtime-core.js";
export type { Observation, ObservationAttributes, ObservationType, TraceBackend } from "./tracing.js";

export interface PiLangfuseDurableOptions extends Omit<DurableRecorderOptions, "conversationId" | "requestId"> {
  harness: Harness;
  conversationId: ConversationId;
  /** Governs observation only. Cancellation never aborts execution or resumes recovery. */
  context: Context;
}

export interface PiLangfuseDurableConversation {
  readonly active: boolean;
  /** Resolves when observation has detached, including cancellation and Harness closure. */
  readonly closed: Promise<void>;
  /** Read committed status without waiting for or starting agent work. Also supports late submission attachment. */
  observeSubmission(id: SubmissionId, correlation?: DurableCorrelation): Promise<void>;
  /** Detach and close observations, without flushing/shutting down the runtime or modifying durable work. */
  dispose(): Promise<void>;
}

const observedConversations = new WeakMap<Harness, Set<ConversationId>>();

/** Attach a fail-open observer using only public durable APIs. A failed attachment returns an inactive controller. */
export async function createPiLangfuseDurableConversation(
  runtime: LangfuseRuntime,
  options: PiLangfuseDurableOptions,
): Promise<PiLangfuseDurableConversation> {
  options = { ...options };
  const { context, cancel } = withCancel(options.context);
  let stream: AgentEventStream | undefined;
  let recorder: DurableRecorder | undefined;
  let releaseRuntime: (() => void) | undefined;
  let disposed = false;
  let ownsConversation = false;
  let initialization: Promise<void> = Promise.resolve();
  let disposePromise: Promise<void> | undefined;
  let resolveClosed!: () => void;
  const closed = new Promise<void>((resolve) => {
    resolveClosed = resolve;
  });

  function report(stage: string): void {
    if (recorder) recorder.report(stage);
    else {
      try {
        Promise.resolve(options.onError?.(stage)).catch(() => undefined);
      } catch {
        /* Fail open. */
      }
    }
  }

  async function readEntry(id: EntryId) {
    const entry = await options.harness.commit((tx) => tx.entry(id), context);
    return disposed ? undefined : entry;
  }

  async function observeSubmission(id: SubmissionId, correlation?: DurableCorrelation): Promise<void> {
    if (disposed) return;
    try {
      const submission = await options.harness.submission(id, context);
      if (disposed || !submission) return;
      const record = await submission.status(context); // wait() would resume paused recovery.
      if (disposed) return;
      await recorder?.submission(record, readEntry, correlation, true);
    } catch {
      if (!disposed) report("submission status read");
    }
  }

  function dispose(): Promise<void> {
    if (disposePromise) return disposePromise;
    disposed = true;
    cancel();
    if (ownsConversation) {
      observedConversations.get(options.harness)?.delete(options.conversationId);
      ownsConversation = false;
    }
    releaseRuntime?.();
    releaseRuntime = undefined;
    recorder?.dispose();
    disposePromise = (async () => {
      await initialization;
      try {
        await stream?.stop();
      } catch {
        report("observer stop");
      }
      resolveClosed();
    })();
    return disposePromise;
  }

  const controller: PiLangfuseDurableConversation = {
    get active() {
      return !disposed && !runtime.closed && stream !== undefined;
    },
    closed,
    observeSubmission,
    dispose,
  };

  async function initialize(): Promise<void> {
    try {
      const conversations = observedConversations.get(options.harness) ?? new Set<ConversationId>();
      if (conversations.has(options.conversationId)) throw new Error("Conversation already has a tracing observer.");
      conversations.add(options.conversationId);
      observedConversations.set(options.harness, conversations);
      ownsConversation = true;
      const internal = getLangfuseRuntimeInternal(runtime);
      releaseRuntime = internal.registerSession(dispose);
      const attached = await watchEvents(options.harness, options.conversationId, context);
      // Retain the owned stream before callback-capable trace acquisition so partial disposal joins it.
      stream = attached;
      if (disposed || runtime.closed) {
        void dispose();
        return;
      }
      // Failed attachment must not open a trace or publish its ID.
      recorder = new DurableRecorder(internal.backend, { ...options, metadata: { ...options.metadata } });
      if (disposed || runtime.closed) {
        recorder.dispose();
        void dispose();
        return;
      }
      recorder.snapshot(stream.snapshot, true);
      stream.start(async (events) => {
        for (const event of events) {
          if (disposed) return;
          try {
            if (event.type === "snapshot") {
              recorder?.snapshot(event);
              const ids = new Set([
                ...(recorder?.submissionIds ?? []),
                ...(event.run?.inputs ?? []),
                ...event.inbox.map((item) => item.id),
              ]);
              for (const id of ids) {
                await observeSubmission(id);
                if (disposed) return;
              }
            } else if (event.type === "submission") {
              await recorder?.submission(event.record, readEntry);
              if (disposed) return;
            } else recorder?.event(event);
          } catch {
            if (!disposed) report("observer delivery");
          }
        }
      });
      // Observe closure even if the host never awaits closed. No execution wait is used.
      void stream.closed
        .then(
          () => dispose(),
          () => {
            report("observer closure");
            return dispose();
          },
        )
        .catch(() => undefined);
      const ids = new Set([...(stream.snapshot.run?.inputs ?? []), ...stream.snapshot.inbox.map((item) => item.id)]);
      for (const id of ids) {
        await observeSubmission(id);
        if (disposed) return;
      }
    } catch {
      report("observer initialization");
      void dispose();
    }
  }
  initialization = initialize();
  await initialization;
  if (disposed) await dispose();
  return controller;
}
