# Progress discriminated-union plan

## Goal

Make `update_progress` advertise the canonical step contract structurally: non-blocked steps omit `reason`, and blocked steps require it. Preserve the input normalization introduced by PR #1462 as a compatibility safeguard.

## Context

Issue [#1461](https://github.com/narumiruna/pi-extensions/issues/1461) reports repeated tool failures because the schema permits `reason` on every status while canonical validation rejects it on non-blocked steps. Direct execution of the current checkout reproduced that mismatch for `pending`, `in_progress`, and `completed`; the schema also accepts blocked steps without a reason, which runtime validation rejects.

[PR #1462](https://github.com/narumiruna/pi-extensions/pull/1462) is merged. This checkout does not yet contain its normalization, so implementation must begin from a base containing that change. The reproduction used globally installed Pi dependencies because local dependencies were absent; implementation verification must use repository-resolved dependencies.

The authoritative schema, state type, validator, and historical decoders live in `packages/pi-progress/src/progress-state.ts`. Tool registration lives in `src/progress-widget.ts`; schema assertions currently live in `test/progress-widget.test.ts`. The package already has cache-contract and generated-runtime tests.

## Design

Use this canonical TypeScript shape:

```ts
type ProgressStep =
  | {
      text: string;
      status: "pending" | "in_progress" | "completed";
    }
  | {
      text: string;
      status: "blocked";
      reason: string;
    };
```

Express the same two branches in `ProgressParameters.steps.items` with TypeBox's union representation. Use Pi AI `StringEnum` for string-valued status schemas, including the single-value blocked discriminator if appropriate. Both object branches must reject additional properties. Keep the existing text, reason, and array bounds.

Retain #1462 normalization before strict canonical validation. Do not add a dummy optional `reason` to the non-blocked TypeScript branch merely to preserve unchecked property access; narrow by `status` in consumers instead. Keep historical types separate and construct canonical union members explicitly when decoding or migrating them.

The union encodes status-dependent field presence, not every runtime invariant. Non-whitespace content, grapheme-aware limits, and at most one `in_progress` step remain authoritative runtime checks. Do not claim complete schema/runtime equivalence for those constraints.

## Scope and applicable rules

Apply `AGENTS.md`, `docs/extension-conventions.md`, and `docs/readme-conventions.md` to these touched areas before implementation:

| Area | Applicable MUST rules | Verification |
| --- | --- | --- |
| Tool contract and validation | Failures remain observable through throws; add deterministic tests for changed behavior. | Test: schema, normalization, and execution cases; Review: Pi argument-processing order. |
| Model-visible tool metadata | Document and test the intentional definition transition; keep ordered tool names, definitions, effective prompt, and existing message prefix stable during subsequent ordinary turns. | Test: normalized provider-facing cache inputs; Review: no per-turn schema mutation. |
| State and compatibility | Preserve fork-sensitive result details and active-branch reconstruction; preserve idempotent context transformations and established boundaries. | Test: restart, branch, historical decoding, and compaction fixtures. |
| Package and runtime | Keep the existing entrypoint, external peer dependencies, and generated-runtime boundaries; record published behavior through Changesets. | Validator: root check; Test: existing generated-runtime loader coverage; Smoke: package-directory load; Review: patch Changeset. |
| Documentation and verification | Preserve required README sections and warnings; run both repository gates. | Review: README checklist and final semantic diff; Validator: `npm run check`; Test: `npm test`. |

No settings, persistence writes, commands, interactive UI, or asynchronous lifecycle flow changes are intended. Read the settings guide only if implementation expands into settings; do not expand scope silently.

## Plan

- [x] Establish an implementation base containing merged #1462 without overwriting unrelated work, then run root `npm install`. Evidence: normalization and its regression tests exist; dependencies resolve from the repository.
- [x] Verify union support through the actual Pi tool path before changing the public schema. Read the installed Extension API documentation and relevant linked API references, then inspect argument preparation, schema validation, and provider schema conversion code. Enumerate relevant provider-conversion branches, including Google handling and strict-schema conversion. Evidence: deterministic request/validation fixtures show the nested union is accepted or faithfully represented, and #1462 normalization still runs early enough to tolerate redundant reasons. If a supported path cannot preserve the contract, document the blocker and obtain a decision rather than silently flattening the union or adding provider-specific extension logic.
- [x] Replace `ProgressStep` with the discriminated union and update `ProgressParameters` to two closed object branches. Preserve descriptions, bounds, and status values; describe `reason` as the external action or condition required to unblock the step. Evidence: typechecking and schema assertions prove non-blocked branches have no `reason` and the blocked branch requires it.
- [x] Update canonical-state consumers with status-based narrowing, especially cloning, rendering, equality, and historical migration code. Preserve #1462 normalization and strict historical decoding. Audit normalized calls against `decodeToolArguments()` and `hasModelVisibleProgressState()` so tolerated input does not accidentally trigger unnecessary restoration context; change only demonstrated cases. Evidence: canonical serialization stays byte-equivalent for valid fixtures, and retained call/result pairs have the expected restoration behavior.
- [x] Add table-driven schema and runtime regression tests. Cover all four statuses; valid mixed arrays and clearing; non-blocked reasons rejected by schema but tolerated by preparation; blocked missing, empty, whitespace, wrong-type, and overlong reasons; unknown statuses and fields; limits and multiple in-progress steps. Test input immutability and rejection without state mutation. Evidence: tests distinguish schema constraints, normalization, and runtime-only invariants rather than assuming they are identical.
- [x] Verify execution and restoration through the registered tool, not only direct validator calls. Confirm non-blocked reasons are absent from successful result details, blocked reasons survive, valid historical state still restores, and malformed history is not retroactively repaired. Exercise TUI and headless result paths with existing harnesses. Evidence: focused package tests and existing lifecycle/compaction tests pass without changing widget behavior.
- [x] Extend cache-contract tests for the schema upgrade. Treat the new static definition as the baseline for a new prefix epoch; compare normalized provider-visible tool fields, effective prompt, ordered names, and serialized message prefixes on consecutive ordinary requests. Evidence: the intentional upgrade is documented and the new definition does not change with progress state or cause repeated synthetic context insertion.
- [x] Update the README tool contract to explain canonical branch rules and #1462 input compatibility without describing `reason` as a general note. Preserve warnings and required sections, audit headings with a fenced-code-aware check, and add a patch Changeset for the improved model-facing contract. Evidence: documentation matches tests and the README conventions checklist; no session data/version migration is introduced.
- [ ] Run final verification sequentially: `npm run check`, then `npm test`. Root check rebuilds Kit before consumer tests; do not run either gate concurrently with a separate Kit build/check. Build the package with `npm --workspace @narumitw/pi-progress run build --if-present` and smoke the generated package through Pi (`pi -e ./packages/pi-progress`, using a non-interactive harness or mode). Run `npm run package:pack -- progress` and inspect the tarball for the existing entrypoint, license, and external dependency boundary. Evidence: commands, loader results, and tarball inspection are recorded; unavailable checks stay open with reasons.
- [x] Run the smallest practical live-provider union-schema smoke after deterministic adapter tests, using configured providers only. Start with readiness-aware non-interactive execution; stop after one clear external/entitlement failure rather than retrying. Evidence: provider schema acceptance is recorded separately from model output quality; missing credentials and untested providers are explicitly named, not claimed as verified.
- [x] Audit the final diff against the touched-area rules and prepare the handoff. Evidence: guides, semantic audits, checks, smokes, deviations, and unverified paths are named; publishing, tagging, and release workflows remain untouched.

## Execution evidence

- Base: `origin/main` at `593111ca` contains #1462; branch `narumi/fix/progress-discriminated-union`; root `npm install` completed without manifest or lockfile changes.
- Pi processing review: `runToolCall()` prepares before schema validation; registered-tool execution tests cover TUI, RPC, print, and JSON. Raw calls are retained while result details are canonical, so current-call matching shares normalization without relaxing historical result decoders.
- Provider review/fixtures: actual request construction preserves the union for Completions, Responses, Codex, Azure, Anthropic, Google, Vertex, Mistral, Bedrock, and pi-messages; Google legacy conversion is also tested. Strict-support flags and Gemini generations are covered. Object unions are unsupported by Pi's strict constrained-sampling conversion; the extension never enabled it and still does not. Ordinary schemas retain the contract, and prefer/require behavior is explicitly tested.
- Final focused package suite: 10 files and 105 tests passed, including boundary/normalization cases, all lifecycle/history fixtures, generated loader coverage, and the real SDK session cache test. Test-emission typechecking passed.
- Cache evidence: schema-upgrade baseline and normalized-call compaction tests pass; real SDK session test compares the full effective system prompt, ordered tool names, Responses-serialized tools, and exact serialized message prefixes across a tool call and an ordinary follow-up.
- Final `npm run check` passed after all changes. Normal pre-commit Biome and affected-workspace typechecks passed; the implementation commit is SSH-signed and GitHub reports its signature as valid.
- Full `npm test`: first attempt hit the Bash 300-second limit; a supervised retry was interrupted after unrelated timeouts. The complete single-worker rerun exited 1: 550 files passed, 4 failed; 7,658 tests passed, 8 skipped, 4 failed (7,670 total). Failures are five-second timeouts in unchanged subagents/resource-attachments, sync/partial-sync, starship/skill, and sync/git-routes. A detached worktree at base `593111ca` reproduced the first, second, and fourth timeouts; its isolated starship invocation instead hit macOS temporary-path canonicalization because it bypassed the root runner's TMPDIR normalization. No timeout was enlarged, and no unrelated implementation/test was changed. A clean local full-suite result remains open; the plan is not complete and must not be deleted.
- PR [#1487](https://github.com/narumiruna/pi-extensions/pull/1487) is draft. GitHub CI run `37586095042` passed both repository checks and the canonical affected `npm test` gate: 22 files, 183 tests. This is affected/root-integration coverage, not a full-suite success claim.
- Documentation: fenced-code-aware required heading/order audit passed for 36 package READMEs; the changed README retains its badges and migration warning. No supported interface or operational section was removed.
- Build/pack: package build and `npm run package:pack -- progress` passed. An actual tarball was extracted and inspected: license/README/source/dist match the existing files list, `pi.extensions` remains `./dist/index.ts`, and Pi peer imports remain external.
- Live smoke: repository-resolved Pi loaded `-e ./packages/pi-progress`; configured OpenAI `gpt-6.1-sol` accepted both schema branches, emitted exactly one canonical tool call, and returned successful version-4 details with no retry (exit 0). Deadline began at a session-start readiness handshake. Other providers have deterministic adapter evidence only, not live acceptance evidence. The globally installed Pi also passed an offline RPC package-load smoke: readiness handshake and successful `get_state` response, followed by deliberate harness termination.
- Applicable guides: `AGENTS.md`, `docs/extension-conventions.md`, `docs/readme-conventions.md`, installed Pi Extension/Package/Provider/SDK documentation and relevant examples. No settings, async UI, lifecycle ownership, or package metadata changes.

## Risks and recovery

Provider adapters may transform nested unions or enforce constraints before normalization. Resolve this early; a local TypeBox test alone is insufficient evidence of provider compatibility.

Changing tool parameters intentionally changes the model-visible request prefix once at upgrade/reload. Preserve the resulting definition throughout the new runtime epoch; no per-turn or per-model schema selection is planned.

A stronger TypeScript type can expose existing unchecked `reason` access or migration constructors. Fix these by narrowing and explicit construction, not casts that erase the union guarantee.

Rollback consists of reverting the union follow-up while retaining #1462. No session or settings files are rewritten, canonical persisted data remains version 4, and the old schema can still represent all valid canonical states. If the union requires a breaking persisted contract or removing normalization, stop and revise this plan with user approval.

## Completion Checklist

- [x] Provider and Pi processing compatibility is verified, or material blockers/unverified paths have an explicit accepted disposition.
- [x] TypeScript and tool schema expose the two canonical branches without an optional non-blocked reason.
- [x] #1462 normalization remains effective through the actual tool-processing path; other validation remains strict.
- [x] Canonical serialization, valid historical restoration, lifecycle behavior, and ordinary-turn cache prefixes remain stable.
- [ ] Regression tests, documentation audits, patch Changeset, root gates, package inspection, and applicable smokes have recorded evidence.
- [x] Final semantic review and handoff are complete; no publication has been performed.

Keep implementation checkboxes open until their acceptance evidence exists. Delete this plan only after implementation and every completion check are finished or explicitly accepted by the user.
