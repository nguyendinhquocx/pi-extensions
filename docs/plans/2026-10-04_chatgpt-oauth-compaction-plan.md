# Verify ChatGPT OAuth Context Management

## Goal

Determine whether the currently stored official OpenAI ChatGPT OAuth credential can complete remote compaction and checkpoint replay through the existing experimental `context-management` protocol on Pi 1.0.2.

## Context

Issue #1421 reports `hardened_oauth_rule_missing` / `rejected_by_hardened_oauth_boundary` during remote compaction with official ChatGPT OAuth. Merged PR #1426 adds diagnostic guidance and native fallback; merged PR #1430 adds explicit opt-in streaming Context Management. Both implementations are present in this checkout.

A live probe using installed Pi 1.0.2, the stored `openai` OAuth credential, `gpt-6.1-sol`, and synthetic conversation history made exactly one `POST https://api.openai.com/v1/responses/compact` request. It returned HTTP 401 with the reported code/type pair. The credential file remained unchanged and temporary files were removed. This confirms the unary rejection for that credential/model at the time of the probe, not a universal OAuth restriction.

The current interactive session uses `openai-codex/gpt-6.1-sol`; that is a distinct provider route. This plan tests the official `openai` route implicated by the issue, not the Codex route.

In a disposable repository copy at commit `6b1644d5`, all 262 `pi-codex-compact` tests passed with Node 26.10.0 and Pi dependencies 1.0.2. These deterministic results verify request handling and fallback, not hosted entitlement. Context Management has not been tested with the current credential during this investigation.

The user approved end-to-end execution, including at most two hosted requests, a focused branch, signed commit, push, and pull request in the subsequent instruction naming this plan. No publication or issue metadata changes are authorized.

## Plan

- [x] Obtain approval for at most two hosted requests and their quota exposure; record approval before making either request. Evidence: the user's end-to-end execution instruction naming this plan.
- [x] Inspect the working tree and installed APIs. Evidence: `origin/main` and HEAD both resolved to `6b1644d5`; created `narumi/docs/verify-chatgpt-compaction`. Reviewed the collector, request implementation, replay tests, and installed credential APIs; copied package source into an isolated temporary directory. Hosted fixture preparation was not applicable after credential preflight failed; no conversation content was sent.
- [x] Resolve a currently valid stored official `openai` OAuth credential without refresh or writes, or stop at the named blocker. Evidence: October 5, 2026 preflight found an expired stored OAuth credential. A hash-bracketed read-only check confirmed expiration and unchanged credential-file content during that check. No refresh, re-login, or key command was run.
- [ ] Blocked: the bounded `context-management` request could not run because the official OAuth credential was expired and refresh was prohibited. Zero hosted requests were dispatched; no protocol success is claimed.
- [ ] Blocked: conditional replay could not run because no Context Management checkpoint was produced.
- [x] Clean up prepared temporary files and inspect the diff. Evidence: the owned temporary directory was removed; no request, timer, listener, or session was created. `git status` showed only the intended plan and evidence note; manifests and lockfile remained unchanged after dependency setup.
- [x] Report observations separately from historical PR claims without changing runtime behavior. Evidence: `docs/implementation-notes/chatgpt-oauth-compaction-verification.md` records the prior unary 401, the expired-credential blocker, zero follow-up requests, historical PR limits, existing opt-in guidance, quota exposure, and the checkpoint-disable warning.

## Scope and Verification Rules

No executable behavior changes are planned, so no new regression tests, Changeset, or release are required for this documentation-only probe. Before completing any repository change under this plan, run both `npm run check` and `npm test` separately from the repository root and record passing results; a blocked live probe does not waive either gate. If evidence suggests a code change, stop and obtain approval for a revised implementation plan before editing.

Apply `docs/extension-conventions.md` lifecycle and verification requirements to the probe: release owned asynchronous resources and avoid stale continuations (`Review` of cancellation/cleanup; bounded live `Smoke`). Review the existing protocol's strict checkpoint validation and stateless replay contract rather than bypassing it. No persistent settings writes or custom UI are in scope.

## Risks

The two requests may consume subscription quota; successful inference may still return no checkpoint. Hosted support can vary by account, model, grant, or date. A successful synthetic replay does not establish compatibility for all real sessions, cache performance, Azure, Codex, or custom providers. Unknown future error shapes must not be treated as proof of the reported authorization failure.

## Rollback / Recovery

Use in-memory credentials and disposable probe files; never publish credentials or copy them into the repository. Do not refresh OAuth credentials because refresh can rotate tokens and invalidate the original login. No persistent configuration or session changes should need rollback. If the credential file changes concurrently, report that observation without overwriting it. Do not disable the extension in sessions containing opaque checkpoints, because disabling also stops checkpoint replay.

## Verification Evidence

- Focused suite: 262 tests in 16 files passed after rebuilding `pi-tui-kit`.
- `npm run check`: builds, Biome, package boundaries, and all workspace typechecks passed.
- Full `VITEST_MAX_WORKERS=2 npm test`: 6,039 tests in 476 files passed with the unchanged five-second test cap.
- No executable changes, metadata changes, or release actions; no new regression test or Changeset is applicable.

### Review-fix verification

The verification counts above describe the initial execution, not a passing review-fix test run. R1 identified the scope rule's incorrect waiver of repository gates; it now requires both gates for every repository change, including when hosted testing is blocked.

- `npm run check` passed after the rule correction; a complete-diff audit found no other gate waiver in this pull request.
- The two-worker full `npm test` retry did not finish within the 300-second command deadline and reported failures in unchanged tests. A focused single-worker run of the seven reported files passed 53 tests and failed one `pi-sync` root-storage test at its unchanged 5,000 ms timeout.
- A single-worker full `npm test` retry was terminated at its owned 600-second subprocess deadline, with no final suite result. It reported timeouts in `pi-sync` Git backend/routes tests and the `pi-chrome-devtools` generated-entry test. No test timeout was increased, unrelated code was changed, or hosted request was made. The cause of these failures remains unverified; the passing root-test gate required for this revision remains blocked.

## Completion Checklist

- [x] Explicit approval for the hosted probe is recorded in Context and the first Plan task.
- [x] Actual Pi version, model, provider, endpoint, request count, and sanitized prior HTTP result are recorded in the evidence note; follow-up preflight has no HTTP result because zero requests were sent.
- [x] Each unattempted path has a named blocker and no success claim: expired official OAuth prevented compaction; absent checkpoint prevented replay.
- [x] No more than two hosted requests were dispatched: this execution sent zero, with no retries or alternate routes.
- [x] Temporary resources are removed, credential-file integrity is checked for the read-only check, and unrelated repository changes are preserved.
- [ ] Both required repository gates must pass after subsequent repository changes before declaring those changes complete; retain passing evidence for `npm run check` and `npm test`. The initial execution passed both gates as recorded above; the review-fix test gate remains blocked by the timeouts recorded in Review-fix verification.
- [ ] The handoff names applicable guidance, the live smoke blocker, risks, and unverified paths; the user accepts the expired-credential blocker. Awaiting user acknowledgement, not further request approval.
- [ ] Delete this plan only after all tasks and preceding completion checks are satisfied or the user explicitly accepts the blocker as the final disposition, and report its former path. Retained while live verification and blocker acknowledgement are pending.
