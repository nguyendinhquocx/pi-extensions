import { createHash } from "node:crypto";
import type { Api, Model } from "@earendil-works/pi-ai";
import type { CompactionRoute } from "./model-api.js";

// Public routing fields and the endpoint observed at the injected fetch boundary.
// Exclude URL credentials/query secrets; only Azure's routing api-version is retained.
export function rejectionRouteKey(
  model: Model<Api>,
  route: Extract<CompactionRoute, { kind: "remote" }>,
  endpoint?: string,
): string {
  const identity = (value: string | undefined) => {
    if (!value) return undefined;
    try {
      const url = new URL(value);
      return [
        url.origin,
        url.pathname,
        route.api === "azure-openai-responses" ? url.searchParams.get("api-version") : null,
      ];
    } catch {
      return undefined;
    }
  };
  const backend = identity(endpoint);
  return createHash("sha256")
    .update(
      JSON.stringify([
        model.provider,
        model.id,
        route.api,
        route.profile,
        route.protocol,
        identity(model.baseUrl),
        backend,
      ]),
    )
    .digest("hex");
}

export class RejectedRoutes {
  private readonly keys = new Set<string>();
  private readonly observed = new Map<string, string>();

  observe(route: string, backend: string): void {
    // Unrelated successful routes must not fill the menu's rejection-state cache.
    // A remembered route still tracks later backend changes, including success.
    if (this.observed.has(route) || (this.keys.has(backend) && this.observed.size < 128))
      this.observed.set(route, backend);
  }

  hasObserved(route: string): boolean {
    const backend = this.observed.get(route);
    return backend !== undefined && this.has(backend);
  }

  has(key: string): boolean {
    return this.keys.has(key);
  }

  add(key: string): void {
    // Retain the first 128 rejected identities until reset. At capacity further
    // identities follow ordinary failure handling, never suppressing unrelated routes.
    if (this.keys.size < 128) this.keys.add(key);
  }
}
