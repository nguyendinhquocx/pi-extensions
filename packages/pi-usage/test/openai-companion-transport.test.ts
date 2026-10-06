import assert from "node:assert/strict";
import { test, vi } from "vitest";
import { queryOpenAICompanionUsage } from "../src/providers/openai-companion-usage.js";
import type { ResolvedUsageAuth } from "../src/types.js";

const auth: ResolvedUsageAuth = {
  apiKey: "native-secret",
  headers: { Authorization: "Bearer native-secret" },
  fingerprint: "fixture",
  model: {
    provider: "openai",
    id: "fixture",
    name: "Fixture",
    baseUrl: "https://api.openai.com",
    api: "openai-responses",
    reasoning: false,
    input: ["text"],
    contextWindow: 128000,
    maxTokens: 4096,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  },
  secrets: ["native-secret", "companion-secret", "account-secret"],
  openaiClientId: "native-client",
  openaiCompanion: { headers: { Authorization: "Bearer companion-secret", "ChatGPT-Account-Id": "account-secret" } },
};
const apps = { items: [{ id: "native-client", windows: [{ used_percent: 5, limit_window_seconds: 60 }] }] };
const plan = { rate_limit: { primary_window: { used_percent: 20, limit_window_seconds: 18000 } } };

for (const [label, payload] of Object.entries({
  absent: {},
  empty: { rate_limit: {} },
  nonfinite: { rate_limit: { primary_window: { used_percent: "NaN", limit_window_seconds: 60 } } },
  contradictory: {
    rate_limit: { primary_window: { used_percent: 10, remaining_percent: 10, limit_window_seconds: 60 } },
  },
  "invalid duration": { rate_limit: { primary_window: { used_percent: 10, limit_window_seconds: 0 } } },
  "invalid reset": { rate_limit: { primary_window: { used_percent: 10, limit_window_seconds: 60, reset_at: -1 } } },
})) {
  test(`invalid plan ${label} cannot publish app-only quota`, async () => {
    vi.stubGlobal("fetch", async (url: string) => new Response(JSON.stringify(url.endsWith("/apps") ? apps : payload)));
    try {
      await assert.rejects(queryOpenAICompanionUsage(auth, new AbortController().signal, 1000, async () => undefined));
    } finally {
      vi.unstubAllGlobals();
    }
  });
}
for (const status of [401, 403, 429, 500, 302]) {
  test(`HTTP ${status} fails without exposing backend secrets`, async () => {
    vi.stubGlobal("fetch", async () => new Response("native-secret companion-secret account-secret", { status }));
    try {
      await assert.rejects(
        queryOpenAICompanionUsage(auth, new AbortController().signal, 1000, async () => undefined),
        (error: Error) => {
          assert.doesNotMatch(error.message, /native-secret|companion-secret|account-secret/);
          return true;
        },
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });
}
for (const body of ["invalid JSON", "x".repeat(1_048_577)]) {
  test(`invalid or oversized response fails closed (${body.length} bytes)`, async () => {
    vi.stubGlobal("fetch", async () => new Response(body));
    try {
      await assert.rejects(queryOpenAICompanionUsage(auth, new AbortController().signal, 1000, async () => undefined));
    } finally {
      vi.unstubAllGlobals();
    }
  });
}
test("whole query timeout aborts a pending request", async () => {
  let aborted = false;
  vi.stubGlobal(
    "fetch",
    (_url: string, init: RequestInit) =>
      new Promise((_resolve, reject) => {
        assert.ok(init.signal);
        init.signal.addEventListener(
          "abort",
          () => {
            aborted = true;
            reject(new DOMException("aborted", "AbortError"));
          },
          { once: true },
        );
      }),
  );
  try {
    await assert.rejects(queryOpenAICompanionUsage(auth, new AbortController().signal, 30, async () => undefined));
    assert.equal(aborted, true);
  } finally {
    vi.unstubAllGlobals();
  }
});
test("guard failure after app response prevents the plan request", async () => {
  const fetch = vi.fn(async () => new Response(JSON.stringify(apps)));
  vi.stubGlobal("fetch", fetch);
  let checks = 0;
  try {
    await assert.rejects(
      queryOpenAICompanionUsage(auth, new AbortController().signal, 1000, async () => {
        if (++checks === 2) throw new Error("stale auth");
      }),
      /stale auth/,
    );
    assert.equal(fetch.mock.calls.length, 1);
  } finally {
    vi.unstubAllGlobals();
  }
});
test("companion query cannot bypass mandatory guard", async () => {
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  try {
    await assert.rejects(queryOpenAICompanionUsage(auth, new AbortController().signal, 1000), /revalidation/);
    assert.equal(fetch.mock.calls.length, 0);
  } finally {
    vi.unstubAllGlobals();
  }
});
test("plan secondary window remains distinct and model-specific windows are ignored", async () => {
  vi.stubGlobal(
    "fetch",
    async (url: string) =>
      new Response(
        JSON.stringify(
          url.endsWith("/apps")
            ? apps
            : {
                ...plan,
                rate_limit: {
                  ...plan.rate_limit,
                  secondary_window: { used_percent: 40, limit_window_seconds: 604800 },
                },
                additional_rate_limits: [{ rate_limit: { primary_window: { used_percent: 99 } } }],
              },
        ),
      ),
  );
  try {
    const result = await queryOpenAICompanionUsage(auth, new AbortController().signal, 1000, async () => undefined);
    assert.deepEqual(
      result.buckets.map((bucket) => [bucket.groupId, bucket.remaining]),
      [
        ["chatgpt-plan", 80],
        ["chatgpt-plan", 60],
        ["chatgpt-app", 95],
      ],
    );
  } finally {
    vi.unstubAllGlobals();
  }
});
