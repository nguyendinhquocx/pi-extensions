import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
  getCurrentSystemPrompt,
  getCurrentTools,
  InMemoryCredentialStore,
  type TranscriptContext,
} from "@earendil-works/pi-ai";
import {
  createAgentSession,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { test } from "vitest";

// Actual provider serializers have no root export.
const specifier = "@earendil-works/pi-ai/api/openai-responses-shared";
const { convertResponsesMessages, convertResponsesTools } = await import(specifier);

test("a real Pi session keeps the full effective prompt and provider prefix stable across progress and ordinary turns", async () => {
  const root = await mkdtemp(join(tmpdir(), "progress-session-cache-"));
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = root;
  const provider = fauxProvider({ provider: "progress-cache", tokensPerSecond: Infinity });
  const model = provider.getModel();
  const requests: Array<{ systemPrompt: string; names: string[]; tools: unknown; messages: unknown[] }> = [];
  const capture = (context: TranscriptContext) => {
    const tools = getCurrentTools(context.messages);
    requests.push({
      systemPrompt: getCurrentSystemPrompt(context.messages),
      names: tools.map((tool) => tool.name),
      tools: JSON.parse(JSON.stringify(convertResponsesTools(tools))),
      messages: JSON.parse(
        JSON.stringify(
          convertResponsesMessages(model, context, new Set([model.provider]), { includeSystemPrompt: false }),
        ),
      ),
    });
  };
  provider.setResponses([
    (context) => {
      capture(context);
      return fauxAssistantMessage(
        fauxToolCall(
          "update_progress",
          {
            steps: [
              { text: "work", status: "in_progress", reason: "checking code" },
              { text: "deploy", status: "blocked", reason: "approval" },
            ],
          },
          { id: "progress-cache-call" },
        ),
        { stopReason: "toolUse" },
      );
    },
    (context) => {
      capture(context);
      return fauxAssistantMessage("working");
    },
    (context) => {
      capture(context);
      return fauxAssistantMessage("still working");
    },
  ]);
  let session: Awaited<ReturnType<typeof createAgentSession>>["session"] | undefined;
  try {
    // Set the agent directory before importing the extension's module-cached settings path.
    const { default: progressWidgetExtension } = await import("../src/progress-widget.js");
    const settingsManager = SettingsManager.inMemory({ retry: { enabled: false }, compaction: { enabled: false } });
    const modelRuntime = await ModelRuntime.create({
      credentials: new InMemoryCredentialStore(),
      modelsPath: null,
      modelsStorePath: join(root, "models-store.json"),
      refreshOnCreate: false,
    });
    modelRuntime.registerNativeProvider(provider.provider);
    const resourceLoader = new DefaultResourceLoader({
      cwd: root,
      agentDir: root,
      settingsManager,
      noExtensions: true,
      noSkills: true,
      noPromptTemplates: true,
      noThemes: true,
      agentsFilesOverride: () => ({ agentsFiles: [] }),
      extensionFactories: [progressWidgetExtension],
    });
    await resourceLoader.reload();
    assert.deepEqual(resourceLoader.getExtensions().errors, []);
    ({ session } = await createAgentSession({
      cwd: root,
      agentDir: root,
      modelRuntime,
      model,
      resourceLoader,
      settingsManager,
      sessionManager: SessionManager.inMemory(root),
      tools: ["update_progress"],
      thinkingLevel: "off",
    }));
    await session.bindExtensions({ mode: "print" });
    await session.prompt("start");
    await session.prompt("continue");
    assert.equal(requests.length, 3);
    const baseline = requests[0];
    assert.ok(baseline);
    assert.match(baseline.systemPrompt, /Use update_progress for multi-step work when meaningful progress changes/u);
    assert.match(
      baseline.systemPrompt,
      /Progress reporting does not prescribe the workflow or require tool calls before work or replies/u,
    );
    assert.doesNotMatch(baseline.systemPrompt, /Before a progress report or final response/u);
    assert.deepEqual(baseline.names, ["update_progress"]);
    assert.equal(session.systemPrompt, baseline.systemPrompt);
    for (const [index, request] of requests.entries()) {
      assert.equal(request.systemPrompt, baseline.systemPrompt);
      assert.deepEqual(request.names, baseline.names);
      assert.deepEqual(request.tools, baseline.tools);
      const previous = requests[index - 1];
      if (previous) assert.deepEqual(request.messages.slice(0, previous.messages.length), previous.messages);
    }
    const result = session.messages.find((message) => message.role === "toolResult");
    assert.ok(result?.role === "toolResult");
    assert.equal(result.isError, false);
    assert.deepEqual(result.details, {
      version: 5,
      steps: [
        { text: "work", status: "in_progress" },
        { text: "deploy — approval", status: "blocked" },
      ],
    });
  } finally {
    session?.dispose();
    if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
    await rm(root, { recursive: true, force: true });
  }
});
