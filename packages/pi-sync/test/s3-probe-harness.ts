import { createHash } from "node:crypto";

/** Shared object-store fixture for isolated conditional capability probes. */
export class S3ProbeHarness {
  readonly objects = new Map<string, Buffer>();
  ignore?: "if-match" | "if-none-match";
  failCleanup = false;
  missingEtag = false;
  unchangedEtag = false;
  onPut?: () => void;

  handle(input: URL | RequestInfo, init?: RequestInit): Response | undefined {
    const key = new URL(String(input)).pathname;
    if (!key.includes("/.pi-sync-probes/")) return undefined;
    const method = init?.method ?? "GET";
    const current = this.objects.get(key);
    const etag = this.etag(current);
    if (method === "DELETE") {
      if (this.failCleanup) return new Response(null, { status: 403 });
      this.objects.delete(key);
      return new Response(null, { status: 204 });
    }
    if (method === "PUT") {
      this.onPut?.();
      const headers = new Headers(init?.headers);
      if (
        (headers.get("if-none-match") === "*" && current && this.ignore !== "if-none-match") ||
        (headers.has("if-match") && headers.get("if-match") !== etag && this.ignore !== "if-match")
      ) {
        return new Response(null, { status: 412 });
      }
      this.objects.set(key, Buffer.from(init?.body as Uint8Array));
      return new Response(null, { status: 200 });
    }
    return current
      ? new Response(new Uint8Array(current), { headers: this.missingEtag || !etag ? {} : { etag } })
      : new Response(null, { status: 404 });
  }

  private etag(body?: Buffer) {
    return body ? `"${this.unchangedEtag ? "constant" : createHash("md5").update(body).digest("hex")}"` : undefined;
  }
}
