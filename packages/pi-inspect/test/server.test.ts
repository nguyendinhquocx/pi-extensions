import { request as httpRequest } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { sendRevision, startServer, type ViewerServer } from "../src/server.js";

const servers: ViewerServer[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => s.close()));
});
async function setup() {
  const controller = new AbortController();
  const server = await startServer({
    signal: controller.signal,
    generation: "g",
    assets: new Map([["/", { type: "text/html", body: "<html><head></head><body>shell</body></html>" }]]),
    snapshot: () => ({ revision: 7 }),
    branch: (id, offset) => ({ id, offset }),
    detail: (id) => ({ id }),
  });
  servers.push(server);
  return { server, controller, headers: { "X-Inspector-Token": server.token } };
}
describe("authenticated loopback server", () => {
  it("serves a data-free shell, authenticates every data route and rejects unsafe requests", async () => {
    const { server, headers } = await setup();
    expect((await fetch(server.origin)).status).toBe(200);
    expect(server.url.length).toBeLessThanOrEqual(68);
    expect(new URL(server.url).hash).toBe(`#${server.token}`);
    expect(server.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(server.token, "base64url")).toHaveLength(32);
    const shell = await (await fetch(server.origin)).text();
    expect(shell).toContain('name="inspector-generation" content="g"');
    expect(shell).not.toContain(server.token);
    for (const route of ["snapshot", "branch", "detail", "events"]) {
      expect((await fetch(`${server.origin}/api/${route}?generation=g`)).status).toBe(401);
      expect(
        (
          await fetch(`${server.origin}/api/${route}?generation=g`, {
            headers: { "X-Inspector-Token": "é".repeat(64) },
          })
        ).status,
      ).toBe(401);
    }
    expect((await fetch(`${server.origin}/api/snapshot?generation=g`, { headers })).status).toBe(200);
    expect((await fetch(`${server.origin}/api/snapshot?generation=old`, { headers })).status).toBe(409);
    expect(
      (
        await fetch(`${server.origin}/api/snapshot?generation=g`, {
          headers: { ...headers, Origin: "https://evil.example" },
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await fetch(`${server.origin}/api/snapshot?generation=g`, {
          headers: { ...headers, "Sec-Fetch-Site": "cross-site" },
        })
      ).status,
    ).toBe(403);
    expect((await fetch(`${server.origin}/api/snapshot?generation=g`, { method: "POST", headers })).status).toBe(405);
    expect((await fetch(`${server.origin}/api/branch?generation=g&offset=-1`, { headers })).status).toBe(400);
    expect((await fetch(`${server.origin}/%2e%2e/package.json`)).status).toBe(404);
    const result = await new Promise<number>((resolve) => {
      const req = httpRequest(
        `${server.origin}/api/snapshot?generation=g`,
        { headers: { ...headers, Host: "evil.example" } },
        (res) => {
          res.resume();
          resolve(res.statusCode ?? 0);
        },
      );
      req.end();
    });
    expect(result).toBe(403);
    const malformed = await new Promise<number>((resolve) => {
      const req = httpRequest(server.origin, { path: "http://[", headers }, (res) => {
        res.resume();
        resolve(res.statusCode ?? 0);
      });
      req.end();
    });
    expect(malformed).toBe(400);
    const response = await fetch(server.origin);
    expect(response.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
  });
  it("encodes public generation metadata without injecting HTML or credentials", async () => {
    const generation = 'epoch"><script>alert(1)</script>&漢字';
    const server = await startServer({
      generation,
      signal: new AbortController().signal,
      assets: new Map([["/", { type: "text/html", body: "<html><head></head><body></body></html>" }]]),
      snapshot: () => ({}),
      branch: () => ({}),
      detail: () => ({}),
    });
    servers.push(server);
    const html = await (await fetch(server.origin)).text();
    expect(html).toContain(`content="${encodeURIComponent(generation)}"`);
    expect(html).not.toContain("<script>");
    expect(html).not.toContain(server.token);
  });
  it("sends revision handshakes, reconnects from a fresh snapshot and bounds slow clients", async () => {
    const { server, headers } = await setup();
    const controller = new AbortController();
    const response = await fetch(`${server.origin}/api/events?generation=g`, { headers, signal: controller.signal });
    const reader = response.body?.getReader();
    expect(reader).toBeDefined();
    if (!reader) return;
    expect(new TextDecoder().decode((await reader.read()).value)).toContain('"generation":"g"');
    server.invalidate(9);
    expect(new TextDecoder().decode((await reader.read()).value)).toContain('"revision":9');
    await reader.cancel();
    controller.abort();
    const response2 = await fetch(`${server.origin}/api/events?generation=g`, {
      headers,
      signal: controller.signal,
    }).catch(() => null);
    expect(response2).toBeNull();
    const reconnect = await fetch(`${server.origin}/api/events?generation=g`, { headers });
    const next = reconnect.body?.getReader();
    if (!next) throw new Error("No stream");
    expect(new TextDecoder().decode((await next.read()).value)).toContain('"revision":9');
    await next.cancel();
    let destroyed = false;
    sendRevision(
      {
        write: () => false,
        destroy: () => {
          destroyed = true;
        },
      },
      "frame",
    );
    expect(destroyed).toBe(true);
  });
  it("limits clients and releases every open socket on abort and repeated close", async () => {
    const { server, controller, headers } = await setup();
    const readers = [];
    for (let i = 0; i < 8; i++) {
      const response = await fetch(`${server.origin}/api/events?generation=g`, { headers });
      const reader = response.body?.getReader();
      if (reader) {
        await reader.read();
        readers.push(reader);
      }
    }
    expect((await fetch(`${server.origin}/api/events?generation=g`, { headers })).status).toBe(429);
    controller.abort();
    await server.close();
    await server.close();
    await Promise.all(readers.map((r) => r.read().catch(() => undefined)));
    await expect(fetch(server.origin)).rejects.toThrow();
  });
  it("cancels partial initialization safely", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      startServer({
        generation: "g",
        signal: controller.signal,
        assets: new Map(),
        snapshot: () => null,
        branch: () => null,
        detail: () => null,
      }),
    ).rejects.toThrow();
    const during = new AbortController();
    const opening = startServer({
      generation: "g",
      signal: during.signal,
      assets: new Map(),
      snapshot: () => null,
      branch: () => null,
      detail: () => null,
    });
    during.abort();
    await expect(opening).rejects.toThrow();
  });
});
