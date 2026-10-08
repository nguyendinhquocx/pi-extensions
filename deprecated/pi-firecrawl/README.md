# 🔥 pi-firecrawl — Deprecated Firecrawl Integration

[![npm](https://img.shields.io/npm/v/@narumitw/pi-firecrawl)](https://www.npmjs.com/package/@narumitw/pi-firecrawl) [![Pi extension](https://img.shields.io/badge/Pi-extension-blue)](https://pi.dev) [![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](./LICENSE)

> [!WARNING]
> `@narumitw/pi-firecrawl` is deprecated in this repository, retained under `deprecated/` for reference, and excluded from active workspace checks, tests, releases, and maintenance.
> Use [Firecrawl MCP](https://github.com/firecrawl/firecrawl-mcp-server) through [Pi's native MCP support](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/mcp.md) instead; follow the [migration instructions](#-migration-to-native-mcp) below.
> This repository change does not deprecate published versions in the npm registry or publish a new release.

This archived extension added Firecrawl tools to Pi for web search, scraping, crawling, URL discovery, and content extraction.

## ✨ Features

- Scrapes a URL into markdown, HTML, links, screenshots, or structured JSON.
- Starts crawl jobs, checks their status, and retrieves completed crawl data.
- Discovers site URLs and searches the web with optional result-page scraping.
- Offers Codemode, Lazy loading, and Direct tools modes with availability controls through `/firecrawl`.
- Supports custom Firecrawl endpoints and shows status only while a tool is running.
- Bounds model-visible output while preserving oversized responses in private temporary files.
- Reads the API key from the environment and never logs, displays, or stores it.

## 📦 Archived reference

The source, tests, and changelog remain here as a historical reference and receive no feature, compatibility, or security fixes.
The archived package declares a build-backed `dist/index.ts`; generated output is not tracked.
Do not install it for new sessions; migrate to native MCP instead.

Pi extensions and local MCP servers run with your user permissions.
Review third-party code before installing or launching it.

## 🔄 Migration to native MCP

Finish active Firecrawl calls and exit Pi before switching integrations.
Remove the npm extension from each scope where it was installed:

```bash
pi uninstall npm:@narumitw/pi-firecrawl
```

Use `pi uninstall --local npm:@narumitw/pi-firecrawl` for a project installation.
Remove any explicit extension paths, `-e` arguments, or extension-tool selections that still load the archived package.
A repository installation no longer includes Firecrawl in the root entrypoint list.

Keep `FIRECRAWL_API_KEY` in your environment; do not paste the key into chat or commit it to project settings.
Merge this server entry into the user-level `<getAgentDir()>/mcp.json` (normally `~/.pi/agent/mcp.json`), preserving any existing servers and other fields:

```json
{
  "mcpServers": {
    "firecrawl": {
      "command": "npx",
      "args": ["-y", "firecrawl-mcp"],
      "env": {
        "FIRECRAWL_API_KEY": "${FIRECRAWL_API_KEY}"
      },
      "exposure": "hidden",
      "toolExposure": {
        "firecrawl_scrape": "codemode",
        "firecrawl_crawl": "codemode",
        "firecrawl_check_crawl_status": "codemode",
        "firecrawl_map": "codemode",
        "firecrawl_search": "codemode"
      }
    }
  }
}
```

The official server offers additional capabilities; this example exposes only the five replacement capabilities for reviewable migration.
Run `pi mcp list` to verify the connection, then start a new Pi session and inspect `/mcp`.
Pi normally activates codemode for servers with codemode tools; if `autoEnableCodemode` is disabled, enable codemode explicitly or choose another exposure.
No scrape, search, or crawl is needed merely to check the connection.

### Tool and settings mapping

With the server named `firecrawl`, tools receive the `mcp__firecrawl__` prefix:

| Archived extension | Native MCP replacement |
| --- | --- |
| `firecrawl_scrape` | `mcp__firecrawl__firecrawl_scrape` |
| `firecrawl_crawl` | `mcp__firecrawl__firecrawl_crawl` |
| `firecrawl_crawl_status` | `mcp__firecrawl__firecrawl_check_crawl_status` |
| `firecrawl_map` | `mcp__firecrawl__firecrawl_map` |
| `firecrawl_search` | `mcp__firecrawl__firecrawl_search` |
| `firecrawl_load` | Pi's built-in `tool_search` with `deferred` exposure, or codemode discovery; no extension loader. |
| `/firecrawl` | `/mcp` for server state, connection, and tool exposure. |
| `toolMode` | `codemode`, `deferred`, or `direct` exposure for each selected MCP tool. |
| `tools` availability | Set unwanted tools to `hidden`; do not expose the entire server unintentionally. |

Update saved tool allowlists and automation, including Plan mode selections, to the new names.
Inspect schemas with codemode's `describeTool()` before porting calls: API options, crawl polling, result formats, and errors are server-owned and are not guaranteed to match this extension.

Pi does not read `pi-firecrawl.json` or legacy `pi-firecrawl-settings.json` for native MCP.
Leave those files untouched as backups until the replacement works; there is no automatic conversion or deletion.
For a custom endpoint, explicitly configure the server's documented `FIRECRAWL_API_URL` in its `env` after reviewing its API requirements; the extension's `FIRECRAWL_BASE_URL` alias is not an automatic migration path.

The extension's activity status, settings menu, 50 KB artifacts, and artifact cleanup are not preserved as contracts.
Pi owns MCP result truncation and temporary output, and the MCP server owns network retries.
URLs, queries, and extraction inputs still go to the configured Firecrawl service; review its privacy policy before sending private data.

## 🚀 Historical quick start

Set `FIRECRAWL_API_KEY`, enable Pi's codemode with `"defaultTools": ["+codemode"]` in Pi's `settings.json`, and start Pi with the extension.
Ask the agent to search or scrape a page through Firecrawl using codemode.
Run `/firecrawl settings` to choose another tool mode or change capability availability.

## ⚙️ Settings

Set a Firecrawl API key before running Pi:

```bash
export FIRECRAWL_API_KEY=fc-your-key
```

Optional API endpoint override:

```bash
export FIRECRAWL_API_URL=https://api.firecrawl.dev/v1
```

`FIRECRAWL_BASE_URL` is also accepted for compatibility.
The API key remains in the environment and is sent only as a bearer credential to the configured Firecrawl endpoint.

Open `/firecrawl settings` in TUI mode to edit Tool mode and the five capability switches.
Mode changes save immediately and apply at the next session start, including `/reload`; capability switches apply immediately using the running mode.
Closing the screen does not undo saved changes.
In RPC mode, the settings route shows the path and manual-edit instructions; print and JSON modes reject this route.

User settings are saved to:

```text
${PI_CODING_AGENT_DIR:-~/.pi/agent}/pi-firecrawl.json
```

```json
{
  "toolMode": "codemode",
  "tools": ["firecrawl_scrape", "firecrawl_crawl", "firecrawl_crawl_status", "firecrawl_map", "firecrawl_search"],
  "updatedAt": 1
}
```

`toolMode` accepts `codemode` (default), `lazy`, or `direct`; see [Tool exposure](#tool-exposure).
Existing valid files without `toolMode` also use the new codemode default, preserving their tool selection.
To restore the previous behavior, choose `lazy` and run `/reload`.
A fresh runtime allows all five capabilities; a missing or invalid file preserves any existing unsaved availability policy across reloads.
Invalid settings produce a warning and block saves until repaired.
Loading a missing file creates nothing; the first explicit settings change creates it.
Manual file edits apply at the next session start, including `/reload`.
There are no project overrides; `tools` controls availability independently from `toolMode`.
Within one Pi process, saves run in invocation order, reread the latest valid document, and preserve unknown fields.
Malformed JSON or invalid recognized fields block saves without replacing the file.
A failed save restores the previous availability and loaded capabilities while preserving other extensions' active tools.
Mode and availability saves change only their owned fields, so an availability edit does not overwrite a pending saved mode.
The file stores mode, tool names, and a timestamp, never `FIRECRAWL_API_KEY`, request headers, or other secrets.

Older versions used `pi-firecrawl-settings.json`.
A legacy-only file remains readable with a warning and is never modified automatically; rename it to `pi-firecrawl.json`.
The next settings save writes the canonical file.
If both files exist, `pi-firecrawl.json` wins and the legacy file is ignored.
The legacy filename is deprecated and will be removed in a future major release.

## 🛠️ Tools

- `firecrawl_load` — find and load capabilities; available only in Lazy loading mode.
- `firecrawl_scrape` — scrape a single URL and return requested formats such as markdown, HTML, links, screenshots, or JSON.
- `firecrawl_crawl` — start a site crawl job and return the Firecrawl job id.
- `firecrawl_crawl_status` — check a crawl job status and retrieve completed crawl data.
- `firecrawl_map` — discover URLs for a site.
- `firecrawl_search` — search the web through Firecrawl and optionally scrape result pages.

### Tool exposure

| Mode | Tool exposure | Loader |
| --- | --- | --- |
| `codemode` (default) | Five allowed tools are callable through codemode and discoverable with `searchTools()` / `describeTool()`, without direct declarations. | None. |
| `lazy` | Only the loader starts active on native-deferred-compatible models; it appends capabilities as needed. | `firecrawl_load` stays active; loading all five yields six active Firecrawl tools. |
| `direct` | All five allowed tools are declared immediately. | None. |

Counts assume all capabilities are enabled.
Disabled capabilities are hidden and cannot be called or activated in any mode; `/firecrawl disable` makes all five unavailable.
Codemode mode does not explicitly activate capability tools; Pi's general tool controls can explicitly declare allowed codemode tools.

These modes require a Pi release with tool exposure support.
Codemode must be active in Pi for the default workflow.
Add `"defaultTools": ["+codemode"]` to Pi's `settings.json` and `/reload`.
Pi's `--tools` flag is an allowlist for extension tools too; a list that omits the Firecrawl capabilities prevents codemode from discovering or calling them.
The extension warns when codemode is inactive and does not silently switch modes.
Choose `lazy` or `direct` if you do not want to enable codemode.

In Lazy loading mode, with native deferred-tool support, only `firecrawl_load` starts active.
The loader accepts a task-oriented `query`, filters to capabilities allowed by settings, and adds up to three matching tools by default without removing any active Pi tool.
Set `limit` from 1 to 5 to change the maximum number loaded by one call.
A general website-crawl query can load both `firecrawl_crawl` and `firecrawl_crawl_status`, while a status-specific query loads the status capability.
Loaded capability tools remain active for the current session until you make them unavailable through `/firecrawl`.
On reload, resume, or fork, capabilities recorded by `firecrawl_load` on the active branch are restored when the current catalog still allows them.

Pi uses native deferred tool references on compatible Anthropic models, native additional-tools or tool-search loading on compatible OpenAI and Codex Responses models, and native Kimi loading on compatible OpenAI Chat Completions models.
Kimi-compatible models declare `compat.deferredToolsMode: "kimi"` in Pi's model metadata.
`azure-openai-responses` remains eager because Pi's Azure adapter does not implement native deferred tool-search serialization.
Fireworks Messages models also remain eager because their native protocol requires the canonical `ToolSearch` or `tool_search` loader name, while this independently installable package keeps the collision-safe `firecrawl_load` name.
When the selected model/provider lacks native deferred support, the extension activates every capability allowed by settings before the next model request instead of using Pi's cache-invalidating lazy-loading fallback.
After a Lazy loading session enters eager exposure, it stays eager across later model switches to avoid removing tool definitions within that session.
Model switches do not change Codemode or Direct tools mode.
The capability tools omit active-only prompt metadata so native deferred loading does not rebuild the system-prompt prefix.

The saved `tools` array controls which capabilities the extension may expose.
An empty array makes every Firecrawl API capability unavailable; only Lazy loading mode retains an active loader.

`firecrawl_load` performs no network request and does not create response artifacts.
Every API capability fails with a clear configuration error when `FIRECRAWL_API_KEY` is missing; configure the key instead of retrying repeatedly.
Settings changes, reloads, and a Lazy loading fallback to eager exposure are intentional model-visible tool transitions; ordinary turns do not reconfigure the tools or rewrite conversation history.

Tool output is limited to 50 KB or 2,000 lines, whichever is reached first.
When a response is truncated, the result reports the original and displayed sizes and the path to a complete temporary JSON file.
Tool-result metadata contains only size and artifact information rather than a duplicate of the raw Firecrawl response.
Oversized Firecrawl error bodies are bounded in the same way.

## 💬 Commands

| Command | Purpose |
| --- | --- |
| `/firecrawl` | Manage available Firecrawl tools and inspect configuration. |
| `/firecrawl help` | Show command usage. |
| `/firecrawl config` (alias: `quickstart`) | Show API-key presence and API URL without revealing the key. |
| `/firecrawl status` | Show running/saved mode, effective exposure, callable and declared counts, loader state, saved catalog, and configuration status. |
| `/firecrawl settings` | Edit tool mode and capability availability in TUI, or show manual-edit instructions in RPC. |
| `/firecrawl tools` (aliases: `toggle`, `select`) | Choose available capabilities; each toggle saves immediately. |
| `/firecrawl enable` (alias: `on`) | Make all five API capabilities available and save the selection. |
| `/firecrawl disable` (alias: `off`) | Make all API capabilities unavailable and save the empty selection. |

All routes support TUI and RPC and reject unknown or trailing arguments.
Only `enable` and `disable` also support print and JSON modes.
Disabling capabilities leaves the slash command available and retains `firecrawl_load` only in Lazy loading mode; see [Tool exposure](#tool-exposure).
Done, Escape, or cancellation closes the tool selector **without undoing saved changes**.

## 🔒 Security and privacy

Firecrawl API tools send requested URLs, options, and related data to the configured API endpoint.
Review the endpoint's privacy policy before sending private or authenticated URLs.

`FIRECRAWL_API_KEY` is sent as a bearer credential but is never logged, displayed, or stored by the extension.
Truncated response artifacts use private temporary files, remain available only for the current session, and are removed on shutdown or reload.

## 🧪 Examples

Call `firecrawl_scrape` to scrape a page as Markdown:

```json
{
  "url": "https://example.com",
  "formats": ["markdown"]
}
```

Call `firecrawl_map` to discover URLs on a small site:

```json
{
  "url": "https://example.com",
  "limit": 20
}
```

Call `firecrawl_crawl` to start a crawl with Markdown extraction:

```json
{
  "url": "https://example.com",
  "limit": 10,
  "scrapeOptions": {
    "formats": ["markdown"]
  }
}
```

## 🧠 Use cases

- Research documentation from inside Pi.
- Crawl websites for migration or audit tasks.
- Extract clean markdown for AI context.
- Discover URLs before scraping a site.
- Combine web search with coding-agent implementation work.

## 🗂️ Package layout

```text
deprecated/pi-firecrawl/
├── src/                               # Authoritative implementation and helpers
│   ├── index.ts                       # Thin Pi entrypoint
│   └── firecrawl.ts                   # Web tools and command orchestration
├── dist/                              # Generated Jiti runtime
├── scripts/build-runtime.mjs          # Runtime builder
└── test/                              # Behavior and lifecycle coverage
```

The generated runtime is built from `src/index.ts` and does not import back into `src`.

## 🔎 Keywords

Pi extension, Pi coding agent, Firecrawl, web scraping, web crawling, URL discovery, web search, markdown extraction, AI research agent, TypeScript Pi tools.

## 📄 License

MIT.
See [`LICENSE`](./LICENSE).
