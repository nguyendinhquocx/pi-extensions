# Sync cleanup review

## Goal
Address the three new findings on PR #1455 without changing sync policy.

## Plan
- [x] Refresh PR state, commits, checks and all 28 threads; no pagination remains; prior 25 outcomes unchanged.
- [x] Clear automatic startup observations at the transfer commit boundary; precommit/committed failure and cancellation regressions pass.
- [x] Separate completed transaction cleanup from rollback; version-6 durable completion precedes deletion; cleanup, marker failure, parser and surviving-evidence regressions pass.
- [x] Index expected directory prefixes and avoid recursive hashing per directory; wide/deep operation counts and existing recovery/naming/removal suites pass.
- [x] Run focused/compiler checks (153 passed, one native skip), npm run check, diff check, built-package RPC smoke and semantic audit.
- [ ] Obtain a green full npm test gate: 6,653 passed / four unchanged pi-worktree Git 2.34.1 failures / one native-filesystem skip. Requires a compatible Git host; no unrelated Git/package changes are authorized. The final additional completed-external-session fixture passes in focused/compiler checks.
- [x] Sign and push implementation commit 3859ccdcc5c593f2f7a715fddb1a62364f4cbe3b (GitHub signature valid); publish three evidence-backed replies and resolve their threads; final refresh confirms 28/28 resolved, matching head and remote CI success.

## Applicable rules and verification
- Lifecycle/status: extension-conventions MUST release session resources, reject stale contexts and clear owned status; Test automatic-transfer suite and Review cancellation/session/timeout boundaries.
- Mutations/persistence: MUST serialize file mutation and retain observable errors; settings guide requires atomic ordered writes and failure recovery; Test transaction cleanup/recovery and Review deletion/commit boundaries. Cleanup after evidence deletion is not a reversible settings write.
- Verification/release: MUST deterministic changed-behavior tests, both gates and Changeset; existing sync Changeset covers follow-up fixes; Validator check, Test npm test, Review final ledger and scope.

## Completion Checklist
- [x] All three in-scope items implemented with passing regressions and published outcomes.
- [x] Checks and failed/unavailable paths reported accurately; prior Git 2.34.1/native-case limits not claimed fixed.
- [x] No unresolved thread; remote refreshed after publication.

## Tooling recovery
A shell-quoting error in reply publication expanded Markdown backticks, unintentionally rerunning checks concurrently and posting malformed bodies. The three existing replies were corrected in place through JSON-file API inputs, with no duplicate replies. A clean sequential npm run check and the nine focused suites passed afterward; tracked source remained unchanged. The green remote CI is independent evidence and does not erase local Git integration failures. This plan is retained only for the failed full local gate.
