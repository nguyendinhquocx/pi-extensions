# Snapshot review replacements

## Goal
Address PR #1455's remaining settings-postimage, case-only replacement, legacy-selection, and rollback-barrier findings without weakening newer-byte protection.

## Plan
- [x] Read current feedback and audit journal/apply branches; preserve existing changes in a separate worktree.
- [x] Resolve session-root ownership only for session targets; verify unused custom roots and retained unsafe session evidence.
- [x] Coalesce proven top-level regular-file case replacements into one version-5 journal entry and backup; verify original-spelling restoration and rejection/interruption classes.
- [x] Require selection review for legacy snapshots and unaccepted recovery candidates; preserve retirement of completed baselines.
- [x] Keep rollback's compatibility force flag behind pending merge evidence; verify both force values before snapshot reads or mutation.
- [x] Run focused suites, both repository gates, and package build/pack/load smoke; report results in the durable review ledger.
- [x] Audit the implementation diff and map all 25 thread findings to evidence-backed outcomes for signed publication.

## Applicable MUST rules and verification
- File mutation serialization: reserve Pi's shared realpath queue once, avoiding alias self-deadlock (Test, Review).
- Cancellation/session ownership: revalidate after awaits and retain ambiguous evidence (Test, Review).
- Settings invalid-file protection: never parse unrelated interrupted settings to authorize agent-root-only recovery; preserve backup/image guards (Test, Review).
- Published behavior and compatibility: update Changeset and journal documentation (Review).
- Deterministic coverage and repository gates: focused regressions, `npm run check`, `npm test` (Test, Validator).

## Rollback / Recovery
Case replacements require version-5 journals; older binaries must not consume pending evidence. Missing/partial armed replacements remain review-only. Backups retain original bytes and naming intent; arbitrary-alias and legacy guards remain intact. Only reviewed push/pull may bypass merge evidence; rollback cannot.

## Completion Checklist
- [x] Implementation and evidence for all five remaining threads are recorded in `packages/pi-sync/docs/merge-implementation-audit.md`.
- [x] Builds, Biome, boundaries, workspace typechecks, focused tests, and built-package RPC smoke pass.
- [ ] Full root test gate passes: four pre-existing pi-worktree failures remain on host Git 2.34.1; final run has 6,640 passing tests.
- [ ] Native case-insensitive filesystem validation passes: the regression is included but skipped on this case-sensitive host; deterministic lookup fixtures pass.

The implementation is ready for publication; this plan remains because these validation paths are not passing/available, not because their results were suppressed.
