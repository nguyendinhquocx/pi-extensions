# ChatGPT OAuth compaction verification

The stored official OpenAI ChatGPT OAuth credential still received the rejection reported in [issue #1421](https://github.com/narumiruna/pi-extensions/issues/1421) when unary compaction was tested on Pi 1.0.2. The subsequent Context Management test stopped before dispatch because that credential had expired. This investigation does not establish whether Context Management currently works for this account.

These are dated observations, not a general authorization guarantee or a supported-version policy.

## Observed results

The repository base was `6b1644d56173b5975c14334d46f41ce20f7ba365`, with Node 26.10.0 and installed Pi 1.0.2. Both tests targeted the official `openai` route, not the distinct `openai-codex` route selected in the interactive session.

| Test | Input and route | Expected | Observed |
| --- | --- | --- | --- |
| Unary compaction, October 4, 2026 | Stored official OpenAI OAuth; `gpt-6.1-sol`; synthetic three-message history; `POST https://api.openai.com/v1/responses/compact` | A validated opaque checkpoint | One request returned HTTP 401 with `hardened_oauth_rule_missing` / `rejected_by_hardened_oauth_boundary`; no retry or alternate route |
| Context Management preflight, October 5, 2026, UTC+08:00 | Read-only inspection of the stored official OpenAI OAuth credential | An unexpired credential usable without refresh | Credential expired; zero hosted requests; compaction not attempted |
| Checkpoint replay | Conditional on successful Context Management compaction | Recover an assistant-only synthetic fact without original plaintext | Not attempted: no Context Management checkpoint was produced |

The unary test used the repository's compaction implementation with Pi's installed provider adapter and disabled retries. It did not send existing sessions, repository instructions, or user conversation history. The credential-file hash matched before and after that request; the disposable probe was removed.

The approved follow-up allowed at most two hosted requests but prohibited OAuth refresh, re-login, credential changes, and alternate routes. Preflight therefore stopped at the expired-credential boundary, rather than sending an invalid token or rotating a refresh token. A subsequent hash-bracketed read-only credential check confirmed expiration and no credential-file change during that check. Prepared temporary source files were deleted. No checkpoint content or credential values were recorded.

## Existing recovery options

Merged [PR #1426](https://github.com/narumiruna/pi-extensions/pull/1426) provides operation-specific diagnostics and Pi-native fallback. It does not grant permission to use `responses/compact`.

Merged [PR #1430](https://github.com/narumiruna/pi-extensions/pull/1430) adds experimental opt-in `context-management`, which uses streaming Responses inference rather than the rejected unary operation. That PR reports successful hosted compaction and replay; this follow-up did not repeat those results.

To try the existing alternative, select **Context Management (experimental)** under `/codex-compact` → **Settings** → **Protocol**, or update only `protocol` to `"context-management"` in the documented global settings file and reload Pi. This makes a normal inference request and can consume quota even if no checkpoint is returned. Support remains backend-, account-, and model-dependent; native fallback may add a summarization request. See the [package's compatibility and recovery guidance](https://github.com/narumiruna/pi-extensions/tree/main/packages/pi-codex-compact#experimental-context-management).

An expired credential must be resolved before another live test, but refreshing or logging in is not a guaranteed remedy for the separate operation-permission rejection. Do not disable the extension in a session containing an opaque checkpoint merely to avoid rejected attempts: disabling also stops checkpoint replay.

## Verification and scope

The focused package suite passed: **262 tests in 16 files**, including the reported OAuth rejection fixture, native fallback, request routing, checkpoint validation, and replay. Those fixtures verify local behavior, not hosted authorization. `npm run check` passed (builds, Biome, package boundaries, and all workspace typechecks). The full `VITEST_MAX_WORKERS=2 npm test` run passed: **6,039 tests in 476 files**, with the unchanged five-second per-test timeout. No executable behavior, credentials, persistent settings, package metadata, or issue metadata changed; no Changeset is needed for this repository-only evidence note.

Reviewed against `docs/extension-conventions.md` for lifecycle cleanup, strict replay validation, verification accuracy, and scope. No settings persistence or custom UI changed. Other accounts/models, the Codex route, Azure/custom providers, real-session recall, and cache performance remain unverified. Further hosted testing requires a valid official OpenAI credential under an approved credential-management policy.
