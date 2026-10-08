# 🌐 pi-chrome-devtools — Deprecated Chrome DevTools Integration

[![npm](https://img.shields.io/npm/v/@narumitw/pi-chrome-devtools)](https://www.npmjs.com/package/@narumitw/pi-chrome-devtools) [![Pi extension](https://img.shields.io/badge/Pi-extension-blue)](https://pi.dev) [![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](./LICENSE)

> [!WARNING]
> `@narumitw/pi-chrome-devtools` is deprecated in this repository, retained under `deprecated/` for reference, and excluded from active workspace checks, tests, releases, and maintenance.
> Use [Chrome DevTools MCP](https://github.com/ChromeDevTools/chrome-devtools-mcp) through [Pi's native MCP support](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/mcp.md) instead; review the [migration instructions and compatibility differences](#-migration-to-native-mcp) below.
> This repository change does not deprecate published versions in the npm registry or publish a new release.

This archived extension inspected browser tabs, navigated pages, evaluated JavaScript, and captured screenshots through the Chrome DevTools Protocol.
Its design was inspired by Chrome DevTools MCP, not an API-compatible implementation.

## ✨ Features

- Lists and selects inspectable pages, navigates URLs, evaluates JavaScript, and captures PNG screenshots.
- Reuses an existing CDP endpoint or launches an isolated Chromium-family browser on first use.
- Recovers from stale page selections and explains browser startup or endpoint failures.
- Loads explicitly approved unpacked extensions only in an extension-owned Chrome for Testing or Chromium process.
- Defaults to codemode-discoverable browser capabilities, with optional lazy and direct exposure.
- Provides availability controls, setup guidance, status, and help through `/chrome-devtools`.
- Shows compact expandable results and activity only while browser tools are running.
- Persists reviewed tool availability while keeping browser connection settings machine-owned.
- Offers opt-in experimental WebMCP discovery and invocation through two fixed gateway tools without dynamically registering page-provided definitions.

## 📦 Archived reference

The source, tests, browser reference, and changelog remain here as historical references and receive no feature, compatibility, or security fixes.
The archived package declares a build-backed `dist/index.ts`; generated output is not tracked.
Do not install it for new sessions; migrate to native MCP instead.

Pi extensions and local MCP servers run with your user permissions.
Review third-party code before installing or launching it.

## 🔄 Migration to native MCP

Finish browser operations and exit Pi before changing integrations so the extension can release its managed browser and temporary profile.
Remove the npm extension from each scope where it was installed:

```bash
pi uninstall npm:@narumitw/pi-chrome-devtools
```

Use `pi uninstall --local npm:@narumitw/pi-chrome-devtools` for a project installation.
Remove explicit extension paths, `-e` arguments, or extension-tool selections that still load the archive.
A repository installation no longer includes Chrome DevTools in the root entrypoint list.

Merge this server entry into the user-level `<getAgentDir()>/mcp.json` (normally `~/.pi/agent/mcp.json`), preserving existing servers and other fields:

```json
{
  "mcpServers": {
    "chrome-devtools": {
      "command": "npx",
      "args": [
        "-y",
        "chrome-devtools-mcp@latest",
        "--isolated",
        "--no-usage-statistics",
        "--no-performance-crux"
      ],
      "env": {
        "CHROME_DEVTOOLS_MCP_NO_CONFIG_DISCOVERY": "1"
      },
      "exposure": "hidden",
      "toolExposure": {
        "list_pages": "codemode",
        "select_page": "codemode",
        "new_page": "codemode",
        "navigate_page": "codemode",
        "evaluate_script": "codemode",
        "take_screenshot": "codemode"
      }
    }
  }
}
```

This example exposes only the six tools needed for ordinary browser migration; additional capabilities stay hidden.
It disables server config-file discovery so an unrelated `cd4a.config.json` cannot silently change launch policy, and uses a temporary browser profile rather than the server's persistent default profile.
Usage statistics and CrUX URL reporting are disabled explicitly; this does not disable Chrome's own metrics.
The server starts Chrome only when a browser tool is called, not merely when Pi connects.
Install a supported Chrome or Chrome for Testing executable before browser use; other Chromium-family browsers are not guaranteed by the upstream server.

Run `pi mcp list` to verify the connection, then start a new Pi session and inspect `/mcp`.
Pi normally activates codemode for servers with codemode tools; if `autoEnableCodemode` is disabled, enable it explicitly or choose another exposure.
A connection check does not prove browser launch, page access, or screenshots work.
See the upstream [configuration](https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/docs/configuration.md) and [tool reference](https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/docs/tool-reference.md) before enabling more tools.

### Tool and settings mapping

With the server named `chrome-devtools`, Pi normalizes its namespace to `mcp__chrome_devtools__`:

| Archived extension | Native MCP replacement |
| --- | --- |
| `chrome_devtools_list_pages` | `mcp__chrome_devtools__list_pages` |
| `chrome_devtools_select_page` | `mcp__chrome_devtools__select_page` |
| `chrome_devtools_navigate` | `mcp__chrome_devtools__navigate_page` for an existing page; `mcp__chrome_devtools__new_page` to create one. |
| `chrome_devtools_evaluate` | `mcp__chrome_devtools__evaluate_script` |
| `chrome_devtools_screenshot` | `mcp__chrome_devtools__take_screenshot` |
| `chrome_devtools_load` | Pi's `tool_search` with `deferred` exposure, or codemode discovery; no extension loader. |
| `/chrome-devtools` | `/mcp` for server state, connection, and tool exposure. |
| `toolMode` / `tools` | Per-tool `codemode`, `deferred`, `direct`, or `hidden` exposure. |
| `browser.endpoint` / disabled auto-launch | Explicit `--browser-url=<endpoint>` to attach to a user-started browser; do not assume attach-first launch fallback. |
| `browser.executablePath` | Explicit `--executable-path=<absolute-path>` for a managed launch. |

Update saved tool allowlists and automation, including Plan mode selections, to the new names.
Inspect schemas with codemode's `describeTool()` before porting calls: selected-page behavior, explicit `pageId` routing, JavaScript function inputs, navigation options, and screenshot `filePath` differ.
Do not assume `select_page` removes the need to pass `pageId` to other tools.

Pi does not convert or consume `pi-chrome-devtools.json`, legacy `pi-chrome-devtools-settings.json`, trusted project extension paths, or `PI_CHROME_DEVTOOLS_*` overrides for native MCP.
Leave the old files untouched as backups until the replacement works; there is no automatic conversion or deletion.
Recreate reviewed connection and availability settings explicitly in the server configuration.

### Compatibility and security differences

- **Browser ownership:** the sample launches an isolated profile; it does not automatically attach to `127.0.0.1:9222` first. Attaching to an existing profile can expose its authenticated pages; use only trusted debugging endpoints and profiles.
- **Screenshots:** the archived extension's cwd/temp path checks, `savePath`, always-save behavior, and cleanup are not replacement contracts. The server owns file output and roots policy; review its `--filesystem-root` settings rather than broadly enabling unrestricted paths.
- **Unpacked extensions:** upstream offers an opt-in extensions category, but its version, browser, and connection requirements differ. The archive's trusted-project path replacement, manifest validation, launch policy, and confirmation behavior are not automatically preserved; review upstream setup before exposing extension installation tools.
- **WebMCP:** upstream offers experimental WebMCP debugging tools, but they do not inherit this extension's per-call Pi confirmation, exact page/schema identity revalidation, or cancellation policy. They remain disabled and hidden in the migration example; do not enable them as a drop-in replacement for the archived gateways.
- **UI and state:** extension settings menus, activity status, compact result renderers, branch activation provenance, and browser/profile cleanup guarantees are not carried over. Pi owns MCP exposure and tool-result handling; the server owns browser lifecycle.

The remaining sections describe historical extension behavior only, not guarantees of the MCP replacement.

## 🚀 Historical quick start

If `codemode` is already in your active tool list, no additional Pi setting is needed. Startup warns when enabled capabilities require codemode but the host tool is inactive; empty catalogs and fully explicit host selections do not produce this warning.
Otherwise, enable Pi's built-in codemode in Pi's `settings.json`:

```json
{ "defaultTools": ["+codemode"] }
```

Start Pi and ask the agent to inspect a browser page. Codemode can discover `chrome_devtools_*` with `searchTools`, inspect schemas with `describeTool`, and call them through `tools`.
A CLI `--tools` list is an allowlist for extension tools too; prefer the additive `defaultTools` setting above.
By default, the extension tries `http://127.0.0.1:9222` and launches an isolated local Chromium-family browser if that endpoint is unavailable.
Run `/chrome-devtools` to review status, settings, help, and available tools.
WebMCP remains disabled until you explicitly enable it.

## 🌐 Browser setup

By default, the extension attaches to `http://127.0.0.1:9222` or launches an isolated local browser on first use.
It never closes an external browser.
Use `/chrome-devtools` → **Browser settings** to change the endpoint, auto-launch policy, or executable.

Read the [browser setup reference](./docs/browser-setup.md) for endpoint requirements, executable discovery, unpacked extensions, manual launch, and deprecated environment overrides.
Manual settings edits apply after `/reload` or session replacement.

> [!WARNING]
> Unpacked extensions execute privileged browser code; load only trusted code.
> They require an extension-owned Chrome for Testing or Chromium process.
> Trusted project settings may replace only the extension-path list, not machine-owned connection settings.

### Experimental WebMCP

> [!WARNING]
> WebMCP is experimental, disabled by default, and subject to Chrome protocol changes.
> Page tools use the visible page's current authentication and require confirmation on every call.

Enable `webmcp.enabled` only in user settings, then choose which gateway tools are available through `/chrome-devtools tools`.
Project settings cannot enable WebMCP or weaken confirmation.
See [WebMCP setup and troubleshooting](./docs/browser-setup.md#experimental-webmcp) for compatible Chrome builds, browser flags, schema limits, and stale-page recovery.

## 🛠️ Tools

- `chrome_devtools_load` — find and load browser capabilities relevant to a task (lazy mode only).
- `chrome_devtools_list_pages` — list inspectable Chrome tabs/pages.
- `chrome_devtools_select_page` — select the active page for later tool calls.
- `chrome_devtools_navigate` — navigate a page to a URL; if no page exists, create one first.
- `chrome_devtools_evaluate` — evaluate JavaScript in the selected page.
- `chrome_devtools_screenshot` — capture a PNG screenshot and save it as a PNG file.
- `chrome_devtools_webmcp_list_tools` — list bounded frame-aware WebMCP descriptors from the selected page when experimental WebMCP is enabled.
- `chrome_devtools_webmcp_call_tool` — invoke one listed page tool after exact identity revalidation and user confirmation.

### Tool exposure

The default `codemode` mode registers five stable capabilities and two fixed experimental WebMCP gateways without a loader. Enabled capabilities are callable through codemode discovery without adding their definitions to the ordinary model request. Explicit host activation of an enabled capability is preserved.
Disabled capabilities are hidden from discovery and calls in every mode, including the WebMCP gateways while their gate is off.

Choose `lazy` or `direct` under **Browser settings → Tool mode** to use another exposure policy; changes require `/reload` or session replacement. Direct mode declares all enabled capabilities without a loader.

In lazy mode, with native deferred-tool support, only `chrome_devtools_load` starts active.
The loader accepts a task-oriented `query`, matches it against the five stable capabilities plus enabled WebMCP gateways, and adds matching available tools without removing any active Pi tool.
Loaded capability tools remain active for the rest of the session unless the user makes them unavailable through `/chrome-devtools`.

Pi uses native deferred tool references on compatible Anthropic models, native additional-tools or tool-search loading on compatible OpenAI and Codex Responses models, and native Kimi loading on compatible OpenAI Chat Completions models.
Kimi-compatible models declare `compat.deferredToolsMode: "kimi"` in Pi's model metadata.
`azure-openai-responses` remains eager because Pi's Azure adapter does not implement native deferred tool-search serialization.
Fireworks Messages models also remain eager because their native protocol requires the canonical `ToolSearch` or `tool_search` loader name, while this independently installable package keeps the collision-safe `chrome_devtools_load` name.

When the selected model/provider lacks native deferred support, the extension activates every capability allowed by settings before the next model request instead of using Pi's cache-invalidating lazy-loading fallback.
After a session enters eager exposure, it stays eager across later model switches to avoid removing tool definitions within that session.
The capability tools omit active-only prompt snippets so native deferred loading does not rebuild the system-prompt prefix.

The saved `tools` array controls which capabilities the extension may expose.
The `webmcp.enabled` gate takes precedence, so persisted WebMCP names cannot bypass a disabled gate.
Page-provided tool definitions appear only in list results and never alter Pi's provider-visible tool definitions.
An empty array makes every browser capability unavailable; only lazy mode retains the loader.

### Screenshot files

`chrome_devtools_screenshot` always saves the captured PNG to disk.
If `savePath` is omitted, the extension writes a unique temp file such as:

```text
/tmp/pi-chrome-devtools-screenshot-<uuid>.png
```

Pass `savePath` to choose the output path:

```js
chrome_devtools_screenshot({
  fullPage: true,
  savePath: "artifacts/homepage.png",
});
```

Relative `savePath` values resolve from Pi's current working directory.
A single leading `@` is stripped to match Pi file-mention paths.
Absolute paths are accepted only when they stay inside the current working directory or the OS temp directory.
Paths containing `..` segments, NUL bytes, symlinked parent directories, directories as targets, final symbolic-link targets, or other non-regular file targets are rejected.
Existing regular files at the target path are replaced.
The tool result includes the resolved path, byte count, and an inline image block when the active model/provider can consume images.
If the model cannot inspect the inline image, ask it to read the saved path, for example `read({ path: "artifacts/homepage.png" })`.

## 💬 Commands

| Command | Purpose |
| --- | --- |
| `/chrome-devtools` | Manage browser-tool availability and browser settings. |
| `/chrome-devtools help` | Show command usage. |
| `/chrome-devtools quickstart` | Show the CDP endpoint, launch candidates, and setup hints. |
| `/chrome-devtools status` | Inspect tools, settings sources, and the last browser launch without probing or starting Chrome. |
| `/chrome-devtools settings` | Change browser settings and tool mode; successful edits save immediately. |
| `/chrome-devtools tools` (aliases: `toggle`, `select`) | Stage tool availability, review the result, and apply it. |
| `/chrome-devtools enable` (alias: `on`) | Immediately make all currently gated capabilities available and save the selection. |
| `/chrome-devtools disable` (alias: `off`) | Immediately make all capabilities unavailable and save the empty selection. |

All routes support TUI and RPC and reject unknown or trailing arguments.
Only `enable` and `disable` also support print and JSON modes.
Disabling capabilities leaves the slash command available and retains `chrome_devtools_load` only in lazy mode; see [Tool exposure](#tool-exposure).

Menu tool changes require **Apply tool changes**; cancellation discards the unconfirmed draft.
Failed apply leaves previous tool availability and settings intact and retains the draft for retry.
Browser settings instead save immediately, and closing the flow does not undo them.
See [Browser setup](./docs/browser-setup.md) for prerequisites and environment-override precedence, and [Experimental WebMCP](#experimental-webmcp) before enabling its gateways.

## ⚙️ Settings

The available capability names are saved to:

```text
${PI_CODING_AGENT_DIR:-~/.pi/agent}/pi-chrome-devtools.json
```

Use **Browser settings** for connection preferences or **Choose available browser tools…** for tool availability.
For example, this partial document attaches to a user-started browser without launching another:

```json
{
  "browser": {
    "endpoint": "http://127.0.0.1:9222",
    "autoLaunch": false
  }
}
```

The same file owns `browser.endpoint`, `browser.autoLaunch`, `browser.executablePath`, `browser.extensionPaths`, and user-only `webmcp.enabled`.
Browser connection fields and `webmcp.enabled` are machine-owned user settings; trusted project files may replace only `browser.extensionPaths`.
Confirmed menu changes apply before the next browser connection and close only an extension-owned managed browser.
Manual JSON edits and unpacked-extension changes apply after `/reload` or session replacement.

`toolMode` accepts `codemode` (default), `lazy`, or `direct` and is user-only. It applies at session start, including `/reload`; availability edits apply immediately without overwriting a pending mode change.
Missing settings and valid older files without `toolMode` now use codemode. To restore the previous loader behavior, save `"toolMode": "lazy"` and reload. Without an explicit catalog, all modes make the stable capabilities available; the active declaration list does not determine configured availability.
A first `/reload` from the previous loader implementation clears carried-over Chrome declarations when applying codemode; enabled capabilities remain callable through codemode. Pi exposes no activation-origin API, so an active loader plus Chrome capabilities without known session provenance is treated as the predecessor's cohort. Capability-only host selections and known explicit activations are preserved. This is an intentional reload-time model-visible prefix transition, not an ordinary-turn change.
Activation provenance is stored as versioned, non-model session metadata and restored from the current branch on session start; a branch without valid provenance drops abandoned-branch caches, so transcript-restoring resume/fork paths can apply codemode without carrying extension-owned declarations forward. Recordless sessions retain the legacy loader-cohort migration policy; unknown capability-only selections remain conservative host selections. Observed host deactivation clears an explicit selection, while extension-caused hiding is not treated as host withdrawal. Re-enabling availability restores retained explicit declarations only when the capability and its WebMCP gate allow it.
A successful lazy activation remains additive if its ownership metadata cannot be saved: the loader reports the loaded tools with a warning rather than removing them or reporting a failed load. Startup and model-switch exposure also remain applied when only metadata persistence fails; lifecycle handlers warn and continue instead of reporting a failed setup. A later loader call or lifecycle update retries pending metadata, including when matching tools are already loaded or the same policy is restored on reload; durable ownership may be incomplete until persistence succeeds. Availability and WebMCP settings saves retain their transactional failure recovery.
A valid saved catalog is restored on Pi startup and `/reload`. An invalid user settings file retains the known effective availability and running mode with a warning, even when valid trusted-project browser settings make the combined load succeed; without a recoverable catalog, only already active capabilities are retained and no new capability is enabled. A fresh invalid configuration therefore leaves browser capabilities disabled until the file is repaired. Invalid settings cannot be overwritten by a save.
A missing file is created by the first confirmed browser or tool setting.
Within one Pi process, all browser and tool saves run in invocation order, reread the latest valid document, publish by temporary-file rename, and preserve unknown fields.
Malformed JSON or invalid recognized fields make menu mutation unavailable and block direct saves without replacement.
Availability saves precede runtime publication. A failed disk write leaves runtime tools unchanged, including host edits made during the save. If runtime publication fails after saving, recovery restores the previous runtime policy and saved catalog before releasing dependent reads or session replacement. Recovery changes only the tool catalog fields, preserves unrelated settings, and refuses to overwrite invalid or newer catalog data; any recovery failure is reported explicitly.

Compatibility: older versions used `pi-chrome-devtools-settings.json`.
A legacy-only file remains readable with a warning and is never modified automatically; rename it to `pi-chrome-devtools.json`.
The first subsequent settings save writes the canonical file.
If both files exist, `pi-chrome-devtools.json` wins and the legacy file is ignored.
The legacy filename is deprecated and will be removed in a future major release.

## 🔒 Security and privacy

A CDP connection can inspect and change browser content, execute JavaScript, and access the selected browser profile's authenticated pages.
Connect only to trusted endpoints and profiles.

The extension never closes an external browser.
It closes only managed browser processes that it started and removes their temporary profiles on a best-effort basis.

Unpacked extensions run privileged browser code and are loaded only into an isolated managed browser after explicit configuration.
WebMCP page tools use the visible page's authentication and require confirmation before every call.
Screenshot output is restricted to the current working directory or OS temporary directory as described above.

## 🧠 Use cases

- Debug front-end applications with an AI coding agent.
- Verify DOM state after code changes.
- Capture screenshots for visual inspection.
- Drive local browser workflows without a separate MCP server.
- Combine with Pi coding tools for end-to-end web app fixes.

## 🗂️ Package layout

```text
deprecated/pi-chrome-devtools/
├── src/                               # Authoritative implementation and helpers
│   ├── index.ts                       # Thin Pi entrypoint
│   └── chrome-devtools.ts             # Browser tools and command orchestration
├── dist/                              # Generated Jiti runtime
├── scripts/build-runtime.mjs          # Runtime builder
├── docs/                              # Published reference documentation
├── reference/webmcp/                  # Repository-only compatibility prototype
└── test/                              # Behavior and lifecycle coverage
```

The generated runtime is built from `src/index.ts` and does not import back into `src`.

## 🔎 Keywords

Pi extension, Pi coding agent, Chrome DevTools Protocol, CDP, WebMCP, browser automation, web debugging, JavaScript evaluation, screenshot automation, AI coding agent tools.

## 📄 License

MIT.
See [`LICENSE`](./LICENSE).
