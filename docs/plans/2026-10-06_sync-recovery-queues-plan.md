# Recovery review and queue safety

## Goal
Address PR #1455's three new findings without expanding directional policy.

## Plan
- [x] Refresh repository/PR identity, head, feedback and checks: open at 44ae3023; prior 28 outcomes unchanged; three new threads; no missing pages; relevant instructions unchanged.
- [x] Recheck recovery pull local hashes/head after backup/root-resolution awaits; nine late-edit/deletion/remote-advance regressions retain evidence and baseline with no commit/apply.
- [x] Reserve case-replacement destination queues after removal and recheck absence before installation; twelve actual Pi-queue regressions verify pre-reservation refusal, both-spelling installation serialization and abort/owner drains.
- [x] Allow validated completed legacy entries to resume cleanup without invented postimages; four interrupted legacy-kind and two malformed/uncompleted controls pass.
- [x] Run changed/focused suites (191 passed, one native skip), npm run check, full tests and semantic audit; 25 new tests fail against 44ae3023 and pass with fixes. Full gate remains four unrelated Git 2.34.1 failures (6,681 passed, one skip).
- [x] Sign/push implementation commit 321ed9e214b4dbaefffcaa825af0d368d72195e3 (GitHub signature valid), publish three evidence-backed replies and resolve their threads; refresh confirms 31/31 resolved and matching remote head. CI is pending.

## Applicable rules and verification
- Mutation queues: extension-conventions MUST serialize same-file mutations through Pi public queues; Test actual withFileMutationQueue behavior, existing/missing paths, original/canonical spellings, cancellation and restoration; Review installed implementation's realpath/ENOENT/ENOTDIR registration branches.
- Lifecycle: MUST reject stale contexts and release owned resources; Test abort/owner replacement and Review every introduced await, including additional queue release on failure.
- Persistence: settings guide requires ordered atomic publication, unknown/invalid-file protection and failure recovery; Test retained merge/transaction evidence, accepted baselines and completed legacy parser branches; Review no rollback over late/newer bytes.
- Verification/release: MUST deterministic behavior tests, both repository gates and Changeset; existing Changeset receives these fixes; Validator check, Test npm test, Review ledger and diff.

## Completion Checklist
- [x] Every new finding has a published evidence-backed outcome and correct thread disposition.
- [x] Checks, deviations and unavailable paths recorded accurately in the package ledger and replies; native case-filesystem regression skips, and case-apply failure now retains evidence for guarded recovery.
- [x] Required publication complete and remote refreshed.
- [ ] Green full local test gate: fresh run still fails four unrelated pi-worktree integrations on Git 2.34.1, with 6,681 passed and one native-filesystem skip. Requires a compatible Git host; no unrelated dependency or Git-service changes were made.

The plan is retained only for the full local validation limitation; fixes and review-thread work are published.
