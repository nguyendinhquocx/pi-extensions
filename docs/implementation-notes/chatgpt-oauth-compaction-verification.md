# ChatGPT OAuth compaction verification

Experimental Context Management and checkpoint replay both succeeded with the stored official OpenAI ChatGPT OAuth credential, `gpt-6.1-sol`, and Pi 1.0.2 on October 5, 2026. Both streaming requests returned HTTP 200; replay recovered an assistant-only synthetic fact with the original plaintext omitted. This verifies the opt-in alternative for this account/model at that time, not permission for the unary operation rejected in [issue #1421](https://github.com/narumiruna/pi-extensions/issues/1421).

These are dated observations, not a general authorization guarantee or a supported-version policy.

## Observed results

The initial repository base was `6b1644d56173b5975c14334d46f41ce20f7ba365`; resumed testing used `46a05a295ebc072d5ff393b95e9c63161101ee93`. The package's relevant source was unchanged between those bases. Node was 26.10.0 and installed Pi was 1.0.2. All probes targeted the official `openai` route, not the distinct `openai-codex` route selected in the interactive session.

| Test | Input and route | Expected | Observed |
| --- | --- | --- | --- |
| Unary compaction, October 4, 2026 | Stored official OpenAI OAuth; `gpt-6.1-sol`; synthetic three-message history; `POST https://api.openai.com/v1/responses/compact` | A validated opaque checkpoint | One request returned HTTP 401 with `hardened_oauth_rule_missing` / `rejected_by_hardened_oauth_boundary`; no retry or alternate route |
| Context Management preflight, October 5, 2026, UTC+08:00 | Read-only inspection of the stored official OpenAI OAuth credential | An unexpired credential usable without refresh | Credential expired; zero hosted requests; compaction not attempted |
| Initial checkpoint replay | Conditional on successful Context Management compaction | Recover an assistant-only synthetic fact without original plaintext | Not attempted during the blocked execution: no Context Management checkpoint was produced |
| Resumed Context Management, October 5, 2026, UTC+08:00 | Official OpenAI OAuth; `gpt-6.1-sol`; synthetic history; `POST https://api.openai.com/v1/responses` | A validated opaque checkpoint | One request returned HTTP 200; existing collector and replacement-history validation accepted one checkpoint item |
| Resumed ordinary checkpoint replay, October 5, 2026, UTC+08:00 | Same provider/model; validated checkpoint plus a new recall question; original plaintext omitted; streaming Responses without `context_management` | Exact recovery of the assistant-only test fact | One request returned HTTP 200 and exactly recovered the expected synthetic passphrase |

The unary test used the repository's compaction implementation with Pi's installed provider adapter and disabled retries. It did not send existing sessions, repository instructions, or user conversation history. The credential-file hash matched before and after that request; the disposable probe was removed.

The initially approved follow-up allowed at most two hosted requests but prohibited OAuth refresh, re-login, credential changes, and alternate routes. Preflight therefore stopped at the expired-credential boundary, rather than sending an invalid token or rotating a refresh token. A subsequent hash-bracketed read-only credential check confirmed expiration and no credential-file change during that check. Prepared temporary source files were deleted. No checkpoint content or credential values were recorded.

## Resumed live probe

After [PR #1440](https://github.com/narumiruna/pi-extensions/pull/1440) merged, the user explicitly authorized Pi's normal refresh of the stored official OpenAI OAuth credential. The follow-up used Pi's public `ModelRuntime.getAuth()` with the normal file-backed store, no model-catalog network refresh, and no custom provider configuration. By the time request auth was resolved, the stored credential was valid. This process dispatched zero OAuth refresh requests; its before/after credential data was identical. Other provider credentials also remained unchanged. This does not identify which earlier action renewed the token.

The disposable probe imported the existing repository implementation with Pi's installed provider adapter. Its synthetic input was 36,505 serialized characters, including an exact passphrase only in an assistant message and unrelated inert archive records. The extension added its maintenance request and 1,024-token compaction threshold. The probe required the normal successful stream completion, checkpoint validation, and bounded replacement-history validation; it did not relax reasoning or output checks.

Replay used the returned checkpoint history and a new recall question, with no original passphrase or archive plaintext in the serialized input. It preserved the stateless encrypted-reasoning include contract and made a normal streaming inference request without Context Management or a previous response ID. The final answer exactly matched the expected passphrase. This verifies transport/checkpoint recall, not a real-session reload, resume, or fork.

Retries were disabled, destinations were restricted to the official endpoints, and dispatch guards allowed one model request per stage. Each model stage had a 90-second cancellation deadline; auth resolution had a 45-second deadline. Abort controllers, timers, signal listeners, and the temporary fetch wrapper were released in `finally`, and temporary source/probe files were removed. No existing conversation, repository instructions, credentials, or opaque checkpoint contents were published. Exactly two model requests and zero OAuth refresh requests were dispatched. Persistent settings and existing sessions were not changed.

## Existing recovery options

Merged [PR #1426](https://github.com/narumiruna/pi-extensions/pull/1426) provides operation-specific diagnostics and Pi-native fallback. It does not grant permission to use `responses/compact`.

Merged [PR #1430](https://github.com/narumiruna/pi-extensions/pull/1430) adds experimental opt-in `context-management`, which uses streaming Responses inference rather than the rejected unary operation. That PR reports successful hosted compaction and replay; the resumed probe independently observed both operations succeeding for the account/model tested here. Default `auto` routing remains unchanged, so the alternative still requires explicit opt-in.

To try the existing alternative, select **Context Management (experimental)** under `/codex-compact` → **Settings** → **Protocol**, or update only `protocol` to `"context-management"` in the documented global settings file and reload Pi. This makes a normal inference request and can consume quota even if no checkpoint is returned. Support remains backend-, account-, and model-dependent; native fallback may add a summarization request. See the [package's compatibility and recovery guidance](https://github.com/narumiruna/pi-extensions/tree/main/packages/pi-codex-compact#experimental-context-management).

An expired credential must be resolved before another live test, but refreshing or logging in is not a guaranteed remedy for the separate operation-permission rejection. Do not disable the extension in a session containing an opaque checkpoint merely to avoid rejected attempts: disabling also stops checkpoint replay.

## Verification and scope

The focused package suite passed again after resumed testing: **262 tests in 16 files**, including the reported OAuth rejection fixture, native fallback, request routing, checkpoint validation, and replay. Those fixtures verify local behavior, not hosted authorization. `npm run check` passed (builds, Biome, package boundaries, and all workspace typechecks).

The initial execution's full `VITEST_MAX_WORKERS=2 npm test` run passed **6,039 tests in 476 files**. Subsequent review and resumed-execution full-suite runs did not complete successfully. The resumed two-worker run reached the 300-second command deadline without a final result, reporting failures in unchanged `pi-sync` Git/settings tests and `pi-goal`/`pi-statusline` generated-entry tests. Their cause is unverified; the historical full-suite pass is not a passing full gate for this follow-up. The five-second per-test cap was unchanged, and unrelated tests/source were not edited.

No executable behavior, credentials, persistent settings, package metadata, or issue metadata changed; no Changeset is needed for this repository-only evidence note.

Reviewed against `docs/extension-conventions.md` for lifecycle cleanup, strict replay validation, verification accuracy, and scope. No settings persistence or custom UI changed. Other accounts/models, the Codex route, Azure/custom providers, real-session recall, and cache performance remain unverified. No further hosted request is needed for this synthetic acceptance test. The successful alternative does not establish that unary compaction is now authorized; that operation was not retried.
