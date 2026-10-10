import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type FauxResponseStep,
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
  getCurrentSystemPrompt,
  getCurrentTools,
} from "@earendil-works/pi-ai";
import {
  createAgentSession,
  DefaultResourceLoader,
  type ExtensionUIContext,
  ModelRuntime,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { expect, it } from "vitest";
import type { ServerOptions, ViewerServer } from "../src/server.js";

it("observes real nested pipelines and preserves the normalized model prefix", async () => {
  const temp = await mkdtemp(join(tmpdir(), "inspector-runtime-"));
  process.env.PI_CODING_AGENT_DIR = temp;
  const { registerInspector } = await import("../src/extension.js");
  const faux = fauxProvider({ tokensPerSecond: Infinity });
  const runtime = await ModelRuntime.create({
    authPath: join(temp, "auth.json"),
    modelsPath: null,
    refreshOnCreate: false,
  });
  runtime.registerNativeProvider(faux.provider);
  const settings = SettingsManager.inMemory({ compaction: { enabled: false }, defaultTools: ["orchestrate"] });
  const requests: string[] = [];
  const steps: FauxResponseStep[] = [
    (context) => {
      requests.push(
        JSON.stringify({
          prompt: getCurrentSystemPrompt(context.messages),
          tools: getCurrentTools(context.messages),
          messages: context.messages,
        }),
      );
      return fauxAssistantMessage([fauxToolCall("orchestrate", {}, { id: "outer" })]);
    },
    (context) => {
      requests.push(
        JSON.stringify({
          prompt: getCurrentSystemPrompt(context.messages),
          tools: getCurrentTools(context.messages),
          messages: context.messages,
        }),
      );
      return fauxAssistantMessage("done");
    },
  ];
  faux.setResponses(steps);
  let enabled = true;
  let serving: ServerOptions | undefined;
  const ends: unknown[] = [];
  const loaderOptions: ConstructorParameters<typeof DefaultResourceLoader>[0] = {
    cwd: temp,
    agentDir: temp,
    settingsManager: settings,
    noExtensions: true,
    noSkills: true,
    noThemes: true,
    noContextFiles: true,
    extensionFactories: [
      (pi) => {
        if (enabled)
          registerInspector(pi, {
            start: async (options) => {
              serving = options;
              return {
                token: "t",
                url: "http://127.0.0.1:1",
                origin: "http://127.0.0.1:1",
                close: async () => {},
                invalidate: () => {},
              } as ViewerServer;
            },
            launch: async () => true,
          });
        pi.on("tool_call", (e) => (e.toolName === "blocked" ? { block: true, reason: "blocked fixture" } : undefined));
        pi.on("tool_result", (e) =>
          e.toolName === "child" ? { content: [{ type: "text", text: "transformed result" }] } : undefined,
        );
        pi.on("tool_execution_end", (e) => {
          ends.push(e);
        });
        pi.registerTool({
          name: "child",
          label: "Child",
          description: "fixture",
          parameters: Type.Object({ value: Type.Number() }),
          exposure: "codemode",
          execute: async () => ({ content: [{ type: "text", text: "original result" }], details: undefined }),
        });
        pi.registerTool({
          name: "blocked",
          label: "Blocked",
          description: "blocked",
          parameters: Type.Object({}),
          exposure: "codemode",
          execute: async () => {
            throw new Error("should not execute");
          },
        });
        pi.registerTool({
          name: "orchestrate",
          label: "Orchestrate",
          description: "orchestrate",
          parameters: Type.Object({}),
          execute: async (_id, _args, signal, _update, ctx) => {
            const calls = await Promise.all([
              ctx.executeTool("child", { value: 1 }, { signal }),
              ctx.executeTool("child", { value: "invalid" }, { signal }),
              ctx.executeTool("blocked", {}, { signal }),
              ctx.executeTool("unknown", {}, { signal }),
            ]);
            return {
              content: [{ type: "text", text: "nested finished" }],
              details: { statuses: calls.map((c) => c.isError) },
            };
          },
        });
      },
    ],
  };
  const loader = new DefaultResourceLoader(loaderOptions);
  await loader.reload();
  const manager = SessionManager.inMemory(temp);
  const { session } = await createAgentSession({
    cwd: temp,
    agentDir: temp,
    resourceLoader: loader,
    settingsManager: settings,
    sessionManager: manager,
    modelRuntime: runtime,
    model: faux.getModel(),
    tools: ["orchestrate", "child", "blocked"],
  });
  const errors: string[] = [];
  try {
    await session.bindExtensions({
      mode: "tui",
      uiContext: {
        confirm: async () => true,
        notify: () => {},
      } as unknown as ExtensionUIContext,
      onError: (e) => {
        errors.push(JSON.stringify(e));
      },
    });
    const prefixBefore = JSON.stringify({
      prompt: session.systemPrompt,
      tools: session.getActiveToolNames(),
      messages: session.messages,
    });
    await session.prompt("/session-inspector");
    expect(serving).toBeDefined();
    expect(
      JSON.stringify({ prompt: session.systemPrompt, tools: session.getActiveToolNames(), messages: session.messages }),
    ).toBe(prefixBefore);
    await session.prompt("run nested fixture");
    expect(errors).toEqual([]);
    expect(ends).toHaveLength(5);
    const view = serving?.snapshot() as {
      calls: { id: string; parentId?: string; status: string; result?: unknown }[];
    };
    expect(serving?.snapshot()).toMatchObject({
      context: {
        source: "observed-pi-context",
        segments: expect.arrayContaining([expect.objectContaining({ role: "system" })]),
      },
    });
    expect(view.calls.filter((c) => c.parentId === "outer")).toHaveLength(4);
    expect(view.calls.find((c) => c.id === "outer/1")?.result).toMatchObject({
      value: { content: [{ type: "text", text: "transformed result" }] },
      truncated: false,
    });
    expect(view.calls.filter((c) => c.parentId && c.status === "error")).toHaveLength(3);
    const persisted = manager.getEntries().filter((e) => e.type === "message" && e.message.role === "toolResult");
    expect(persisted).toHaveLength(1);
    expect(JSON.stringify(persisted)).toContain("nestedCalls");
    expect(requests).toHaveLength(2);
    const first = JSON.parse(requests[0] ?? "{}");
    const second = JSON.parse(requests[1] ?? "{}");
    expect(second.prompt).toBe(first.prompt);
    expect(second.tools).toEqual(first.tools);
    expect(second.messages.slice(0, first.messages.length)).toEqual(first.messages);
    await session.prompt("/session-inspector stop");
    enabled = false;
    faux.setResponses(steps);
    const baselineLoader = new DefaultResourceLoader(loaderOptions);
    await baselineLoader.reload();
    const { session: baseline } = await createAgentSession({
      cwd: temp,
      agentDir: temp,
      resourceLoader: baselineLoader,
      settingsManager: settings,
      sessionManager: SessionManager.inMemory(temp),
      modelRuntime: runtime,
      model: faux.getModel(),
      tools: ["orchestrate", "child", "blocked"],
    });
    try {
      await baseline.bindExtensions({ mode: "print" });
      await baseline.prompt("run nested fixture");
      const normalize = (key: string, value: unknown): unknown =>
        ["timestamp", "usage", "durationMs", "details", "nestedCalls", "diagnostics", "responseId"].includes(key)
          ? undefined
          : value;
      const inputs = requests.map((request) => JSON.stringify(JSON.parse(request), normalize));
      expect(inputs.slice(2)).toEqual(inputs.slice(0, 2));
    } finally {
      baseline.dispose();
    }
  } finally {
    session.dispose();
    await rm(temp, { recursive: true, force: true });
  }
});
