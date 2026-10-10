import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const cli = fileURLToPath(
  new URL("../../../node_modules/@earendil-works/pi-coding-agent/dist/cli.js", import.meta.url),
);
for (const mode of ["text", "json"]) {
  const temp = await mkdtemp(join(tmpdir(), "inspector-mode-"));
  try {
    const child = spawn(
      process.execPath,
      [
        cli,
        "--print",
        "--mode",
        mode,
        "--offline",
        "--no-session",
        "--no-skills",
        "--no-mcp",
        "--no-extensions",
        "--provider",
        "faux",
        "--model",
        "faux-1",
        "-e",
        join(root, "test", "reload-helper.ts"),
        "-e",
        root,
        "/inspect",
      ],
      { env: { ...process.env, PI_CODING_AGENT_DIR: temp }, stdio: ["pipe", "pipe", "pipe"] },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.stdin.end();
    const [code] = await once(child, "exit");
    assert.equal(code, 0, stderr);
    assert(stderr.includes("requires TUI"));
    if (mode === "json") for (const line of stdout.split("\n").filter(Boolean)) JSON.parse(line);
    console.log(`${mode}: observable opening rejection without protocol corruption passed`);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}
for (const mode of ["explicit", "discovery"]) {
  const temp = await mkdtemp(join(tmpdir(), "inspector-smoke-"));
  const agentDir = join(temp, "agent");
  if (mode === "discovery") {
    await mkdir(join(temp, ".pi", "extensions"), { recursive: true });
    await symlink(join(root, "src"), join(temp, ".pi", "extensions", "inspect"), "dir");
  }
  const args = [
    cli,
    "--mode",
    "rpc",
    "--offline",
    "--no-session",
    "--no-skills",
    "--no-mcp",
    "--provider",
    "faux",
    "--model",
    "faux-1",
    "-e",
    join(root, "test", "reload-helper.ts"),
  ];
  if (mode === "explicit") args.push("--no-extensions", "-e", root);
  else args.push("--approve");
  const child = spawn(process.execPath, args, {
    cwd: temp,
    env: { ...process.env, PI_CODING_AGENT_DIR: agentDir },
    stdio: ["pipe", "pipe", "pipe"],
  });
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  const exited = once(child, "exit");
  const pending = new Map();
  const events = [];
  let buffer = "";
  let stderr = "";
  let id = 0;
  let ready = false;
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  child.stdout.on("data", (chunk) => {
    buffer += chunk.toString("utf8");
    let newline = buffer.indexOf("\n");
    while (newline !== -1) {
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      if (line) {
        const record = JSON.parse(line);
        if (record.type === "response" && pending.has(record.id)) {
          const request = pending.get(record.id);
          pending.delete(record.id);
          clearTimeout(request.timer);
          if (record.success) request.resolve(record.data);
          else request.reject(new Error(record.error));
        } else events.push(record);
      }
      newline = buffer.indexOf("\n");
    }
  });
  const rejectPending = () => {
    for (const request of pending.values()) {
      clearTimeout(request.timer);
      request.reject(new Error(`Pi exited: ${stderr}`));
    }
    pending.clear();
  };
  child.on("exit", rejectPending);
  child.on("error", rejectPending);
  function send(command) {
    const requestId = String(++id);
    return new Promise((resolveRequest, reject) => {
      const timer = ready
        ? setTimeout(() => {
            pending.delete(requestId);
            reject(new Error("Ready Pi command timed out"));
          }, 5000)
        : undefined;
      pending.set(requestId, { resolve: resolveRequest, reject, timer });
      child.stdin.write(`${JSON.stringify({ ...command, id: requestId })}\n`);
    });
  }
  try {
    await send({ type: "get_state" }); // Readiness handshake precedes every timing deadline.
    ready = true;
    const verifyCommands = async () => {
      const data = await send({ type: "get_commands" });
      assert(data.commands.some((command) => command.name === "inspect"));
      assert(data.commands.some((command) => command.name === "session-inspector"));
    };
    await verifyCommands();
    await send({ type: "prompt", message: "/inspect" });
    assert(
      events.some(
        (event) =>
          event.type === "extension_ui_request" && event.method === "notify" && event.message.includes("requires TUI"),
      ),
    );
    await send({ type: "prompt", message: "/inspect stop" });
    await send({ type: "prompt", message: "/inspector-smoke-reload" });
    await verifyCommands();
    await send({ type: "new_session" });
    await verifyCommands();
    assert(!events.some((event) => event.type === "extension_error"));
    console.log(`${mode}: load, RPC rejection, stop, reload, session replacement passed`);
  } finally {
    child.stdin.end();
    const deadline = ready ? setTimeout(() => child.kill("SIGKILL"), 5000) : undefined;
    await exited;
    clearTimeout(deadline);
    await rm(temp, { recursive: true, force: true });
  }
}
