import assert from "node:assert/strict";
import { type Api, type Model, normalizeContext, type StreamFunction, type Tool } from "@earendil-works/pi-ai";
import { Compile } from "typebox/compile";
import { test } from "vitest";
import { ProgressParameters } from "../src/progress-state.js";

// These conversion helpers/implementations have no Pi AI root exports. Variable
// specifiers avoid Pi's static api-subpath resolution problem.
const implementations = new Map<string, { stream: StreamFunction<Api> }>();
for (const api of [
  "openai-completions",
  "openai-responses",
  "openai-codex-responses",
  "azure-openai-responses",
  "anthropic-messages",
  "google-generative-ai",
  "google-vertex",
  "mistral-conversations",
  "bedrock-converse-stream",
  "pi-messages",
]) {
  const specifier = `@earendil-works/pi-ai/api/${api}`;
  implementations.set(api, await import(specifier));
}
const googleSpecifier = "@earendil-works/pi-ai/api/google-shared";
const { convertTools } = await import(googleSpecifier);
const strictSpecifier = "@earendil-works/pi-ai/api/constrained-sampling";
const { resolveJsonSchemaStrictSampling } = await import(strictSpecifier);

const tool: Tool<typeof ProgressParameters> = {
  name: "update_progress",
  description: "Progress",
  parameters: ProgressParameters,
};
const context = normalizeContext({
  systemPrompt: "Use progress for multi-step work.",
  tools: [tool],
  messages: [{ role: "user", content: [{ type: "text", text: "start" }], timestamp: 0 }],
});

function assertStepContract(parameters: unknown) {
  const schema = parameters as typeof ProgressParameters;
  assert.deepEqual(schema.properties.steps, ProgressParameters.properties.steps);
  const validator = Compile(schema);
  for (const status of ["pending", "in_progress", "completed", "blocked"]) {
    assert.equal(validator.Check({ steps: [{ text: "work", status }] }), true);
    assert.equal(validator.Check({ steps: [{ text: "work", status, reason: "note" }] }), false);
  }
  assert.equal(validator.Check({ steps: [{ text: "x".repeat(503), status: "blocked" }] }), true);
  // Runtime preparation enforces grapheme limits; provider schemas cannot encode them.
  assert.equal("maxLength" in schema.properties.steps.items.properties.text, false);
}

interface Payload {
  tools?: Array<{
    input_schema?: unknown;
    function?: { parameters: unknown };
    parameters?: unknown;
    strict?: unknown;
    functionDeclarations?: Array<{ parametersJsonSchema?: unknown }>;
  }>;
  config?: { tools?: Array<{ functionDeclarations: Array<{ parametersJsonSchema: unknown }> }> };
  toolConfig?: { tools: Array<{ toolSpec: { inputSchema: { json: unknown } } }> };
  context?: { messages: Array<{ role: string; toolsAdded?: Tool[] }> };
}

const codexToken = `header.${Buffer.from(JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: "fixture" } })).toString("base64url")}.signature`;
const fixtures: Array<{ api: Api; provider: string; id: string; compat?: Model<Api>["compat"] }> = [
  { api: "openai-completions", provider: "openai", id: "fixture" },
  { api: "openai-completions", provider: "fixture", id: "fixture", compat: { supportsStrictMode: false } },
  { api: "openai-responses", provider: "openai", id: "fixture" },
  { api: "openai-responses", provider: "fixture", id: "fixture", compat: { supportsStrictMode: false } },
  { api: "openai-codex-responses", provider: "openai-codex", id: "fixture" },
  { api: "azure-openai-responses", provider: "azure-openai-responses", id: "fixture" },
  { api: "anthropic-messages", provider: "anthropic", id: "claude-sonnet-4-6" },
  { api: "anthropic-messages", provider: "fixture", id: "fixture", compat: { supportsStrictTools: false } },
  { api: "google-generative-ai", provider: "google", id: "gemini-2.5-flash" },
  { api: "google-generative-ai", provider: "google", id: "gemini-3-flash-preview" },
  { api: "google-vertex", provider: "google-vertex", id: "gemini-3-flash-preview" },
  { api: "mistral-conversations", provider: "mistral", id: "fixture" },
  { api: "bedrock-converse-stream", provider: "amazon-bedrock", id: "fixture", compat: { supportsStrictMode: true } },
  { api: "bedrock-converse-stream", provider: "amazon-bedrock", id: "fixture", compat: { supportsStrictMode: false } },
  { api: "pi-messages", provider: "fixture", id: "fixture" },
];

for (const fixture of fixtures) {
  test(`provider payload retains the single step shape: ${fixture.api}/${fixture.id}/${JSON.stringify(fixture.compat ?? {})}`, async () => {
    const implementation = implementations.get(fixture.api);
    assert.ok(implementation);
    const model: Model<Api> = {
      ...fixture,
      baseUrl: "https://fixture.invalid/v1",
      reasoning: false,
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 8192,
      maxTokens: 128,
      name: "fixture",
    };
    let captured: Payload | undefined;
    const result = await implementation
      .stream(model, context, {
        apiKey: fixture.api === "openai-codex-responses" ? codexToken : "fixture-key",
        env: { AWS_ACCESS_KEY_ID: "fixture", AWS_SECRET_ACCESS_KEY: "fixture", AWS_REGION: "us-east-1" },
        onPayload(payload) {
          captured = JSON.parse(JSON.stringify(payload)) as Payload;
          // End before sending: these tests exercise actual request construction,
          // never provider credentials, retries, or external network traffic.
          throw new Error("payload captured without network");
        },
      })
      .result();
    assert.ok(captured, result.errorMessage ?? "provider did not construct a payload");
    assert.match(result.errorMessage ?? "", /payload captured without network/u);
    let parameters: unknown;
    switch (fixture.api) {
      case "google-generative-ai":
      case "google-vertex":
        parameters = captured.config?.tools?.[0]?.functionDeclarations[0]?.parametersJsonSchema;
        break;
      case "anthropic-messages":
        parameters = captured.tools?.[0]?.input_schema;
        break;
      case "openai-completions":
      case "mistral-conversations":
        parameters = captured.tools?.[0]?.function?.parameters;
        break;
      case "bedrock-converse-stream":
        parameters = captured.toolConfig?.tools[0]?.toolSpec.inputSchema.json;
        break;
      case "pi-messages":
        parameters = captured.context?.messages.find((message) => message.role === "system")?.toolsAdded?.[0]
          ?.parameters;
        break;
      default:
        parameters = captured.tools?.[0]?.parameters;
    }
    assert.ok(parameters, JSON.stringify(captured));
    assertStepContract(parameters);
  });
}

test("Google legacy conversion retains the closed step object", () => {
  const converted = convertTools([tool], true, false);
  assertStepContract(converted[0].functionDeclarations[0].parameters);
});

test("the simple schema does not opt into strict constrained sampling", () => {
  assert.equal(tool.constrainedSampling, undefined);
  for (const supportsStrict of [true, false]) {
    assert.equal(resolveJsonSchemaStrictSampling(tool, supportsStrict), undefined);
  }
});
