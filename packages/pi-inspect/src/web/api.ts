import { useEffect, useRef, useState } from "react";
import type { DetailView } from "../model.js";

// Storage is optional reload persistence; a valid fragment must work in restricted profiles.
function stored(key: string): string | null {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}
function remember(key: string, value: string): void {
  if (!value) return;
  try {
    sessionStorage.setItem(key, value);
  } catch {
    // Keep credentials in memory for this page; fragment-free reloads must reopen from Pi.
  }
}
const fragment = location.hash.slice(1);
const params = new URLSearchParams(fragment);
// Continue accepting legacy #token=...&generation=... URLs and fragment-free browser reloads.
const token = /^[\w-]{43}$/.test(fragment) ? fragment : (params.get("token") ?? stored("inspector-token") ?? "");
const shellGeneration = document.querySelector<HTMLMetaElement>('meta[name="inspector-generation"]')?.content;
export const generation =
  params.get("generation") ??
  (shellGeneration ? decodeURIComponent(shellGeneration) : (stored("inspector-generation") ?? ""));
remember("inspector-token", token);
remember("inspector-generation", generation);
history.replaceState(null, "", location.pathname);
export function headers(): HeadersInit {
  return { "X-Inspector-Token": token };
}
export class RequestFailure extends Error {
  constructor(
    message: string,
    readonly terminal: boolean,
  ) {
    super(message);
  }
}
export async function request<T>(route: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(
    `/api/${route}${route.includes("?") ? "&" : "?"}generation=${encodeURIComponent(generation)}`,
    { headers: headers(), signal, cache: "no-store" },
  );
  if (!response.ok)
    throw new RequestFailure(
      [401, 403, 409, 410].includes(response.status)
        ? "Session expired; open a new viewer from Pi."
        : "Viewer unavailable; reconnecting requires a running Pi session.",
      [401, 403, 409, 410].includes(response.status),
    );
  return response.json() as Promise<T>;
}
interface Job {
  signal: AbortSignal;
  run(): Promise<void>;
  cancel(): void;
}
const queue: Job[] = [];
const cache = new Map<string, DetailView>();
let active = 0;
function pump(): void {
  while (active < 4 && queue.length) {
    const job = queue.shift();
    if (!job || job.signal.aborted) continue;
    active++;
    void job.run().finally(() => {
      active--;
      pump();
    });
  }
}
function loadDetail(id: string, signal: AbortSignal): Promise<DetailView> {
  signal.throwIfAborted();
  const cached = cache.get(id);
  if (cached) return Promise.resolve(cached);
  return new Promise((resolve, reject) => {
    const job: Job = {
      signal,
      cancel: () => {
        const index = queue.indexOf(job);
        if (index !== -1) queue.splice(index, 1);
        reject(new DOMException("Cancelled", "AbortError"));
      },
      run: async () => {
        try {
          const value = await request<DetailView>(
            `detail?id=${encodeURIComponent(id)}&leaf=${encodeURIComponent(id)}`,
            signal,
          );
          if (signal.aborted) return;
          // Raw entries and their own historical projection are immutable; live calls use the latest snapshot.
          const result = cache.get(id) ?? { ...value, calls: [] };
          cache.set(id, result);
          while (cache.size > 64) {
            const first = cache.keys().next().value;
            if (first === undefined) break;
            cache.delete(first);
          }
          resolve(result);
        } catch (error) {
          reject(error);
        } finally {
          signal.removeEventListener("abort", job.cancel);
        }
      },
    };
    signal.addEventListener("abort", job.cancel, { once: true });
    queue.push(job);
    pump();
  });
}
export function useDetail(id: string | undefined): { detail?: DetailView; error: string; retry(): void } {
  const [attempt, setAttempt] = useState(0);
  const owner = useRef<{ id: string; attempt: number } | undefined>(undefined);
  const retry = () => setAttempt((value) => value + 1);
  const [state, setState] = useState<{ id?: string; detail?: DetailView; error: string }>({ error: "" });
  useEffect(() => {
    if (!id) return;
    const requestOwner = { id, attempt };
    owner.current = requestOwner;
    const controller = new AbortController();
    setState({ id, error: "" });
    void loadDetail(id, controller.signal)
      .then((detail) => {
        if (!controller.signal.aborted && owner.current === requestOwner) setState({ id, detail, error: "" });
      })
      .catch(() => {
        if (!controller.signal.aborted && owner.current === requestOwner)
          setState({ id, error: "Could not load entry details." });
      });
    return () => controller.abort();
  }, [id, attempt]);
  return { ...(state.id === id ? state : { error: "" }), retry };
}
