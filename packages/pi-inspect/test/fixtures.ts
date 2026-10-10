import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { SessionManager, type ToolInfo } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
export function fixture() {
  const manager = SessionManager.inMemory("/fixture");
  const system = manager.appendMessage({
    role: "system",
    content: "",
    sections: { preamble: "base", rules: "original" },
    toolsAdded: [{ name: "read", description: "Read a file", parameters: Type.Object({ path: Type.String() }) }],
    timestamp: 1,
  });
  const user = manager.appendMessage({
    role: "user",
    content: "first request <script>alert(1)</script>",
    timestamp: 2,
  });
  const assistant = manager.appendMessage(
    fauxAssistantMessage([
      fauxToolCall(
        "codemode",
        { code: 'await tools.read({path:"/skills/example/SKILL.md"}); text("done")' },
        { id: "parent" },
      ),
    ]),
  );
  const result = manager.appendMessage({
    role: "toolResult",
    toolCallId: "parent",
    toolName: "codemode",
    isError: false,
    timestamp: 3,
    content: [{ type: "text", text: "Script completed\nOutput: done" }],
    nestedCalls: {
      calls: [
        { id: "parent/1", name: "read", status: "ok", arguments: { path: "/skills/example/SKILL.md" }, durationMs: 3 },
      ],
      complete: true,
    },
  });
  manager.branch(user);
  const alternate = manager.appendMessage({ role: "user", content: "alternate branch", timestamp: 4 });
  manager.branch(result);
  const delta = manager.appendMessage({
    role: "system",
    content: "",
    sections: { rules: "changed" },
    toolsRemoved: [{ name: "read" }],
    timestamp: 5,
  });
  manager.appendContextEdit(user, { content: "edited for context only" });
  const compact = manager.appendCompaction("summary", assistant, 1000);
  const leaf = manager.appendMessage({ role: "user", content: "after compaction", timestamp: 6 });
  manager.appendLabelChange(alternate, "Alternative");
  manager.appendCustomEntry("future-state", { unknown: true });
  return { manager, system, user, assistant, result, alternate, delta, compact, leaf };
}
export const skills = [{ name: "example", path: "/skills/example/SKILL.md", description: "Example skill" }];
export const tools: ToolInfo[] = [
  {
    name: "read",
    description: "Read",
    parameters: Type.Object({ path: Type.String() }),
    exposure: "direct",
    sourceInfo: { source: "test", path: "/fixture", scope: "temporary", origin: "top-level" },
  },
  {
    name: "mcp__docs__search",
    description: "Search",
    parameters: Type.Object({ query: Type.String() }),
    exposure: "codemode",
    namespace: { name: "mcp__docs" },
    sourceInfo: { source: "test", path: "/fixture", scope: "temporary", origin: "top-level" },
  },
  {
    name: "hidden",
    description: "Hidden",
    parameters: Type.Object({}),
    exposure: "hidden",
    sourceInfo: { source: "test", path: "/fixture", scope: "temporary", origin: "top-level" },
  },
];
