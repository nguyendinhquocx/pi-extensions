# Content merge and partial-progress audit

New content/partial policies are opt-in and leave legacy defaults, directional semantics, and activation unchanged. This phase builds on the safe automatic-transfer and settings/local-field audits; no resource reload, session resume, model-visible prefix transition, cross-extension protocol, or watcher was added.

## Contracts and touched-area rules

The applicable guides are `docs/extension-conventions.md`, `docs/extension-settings.md`, and `docs/readme-conventions.md`. Lifecycle ownership/cancellation, fresh state after awaits, ordered unknown-preserving settings writes, private persistence, sanitized exact reviews, native standard keys/mode behavior, independent packaging, Changesets, root gates and runtime smokes remain mandatory. Native Pi select/confirm and the existing Kit document review own key handling/disposal; there are no new screen-level shortcuts or custom key hints.

Authoritative session sources are installed Pi `core/session-manager.js`/`.d.ts` and `core/messages.d.ts`. Pi's loader repairs incomplete/old logs and ignores malformed lines; the merger deliberately does neither. Only the audited v3 format is eligible. Header and every complete immutable record must remain byte-identical in the prefix; ids are unique, parents are backward references, the first entry is the only null-parent root, context targets/compaction/branch references exist, and every supported kind passes its payload checks. Opaque custom details are retained, not interpreted. Unknown roles/kinds/API migrations and unsupported payloads require review; no branch union or live resume is performed.

Text allowlist: `AGENTS.md`, and Markdown/text below `prompts/` or `skills/`. UTF-8 round-trip validation and NUL refusal precede bounded line-preserving LCS hunks. Equal edits deduplicate; disjoint edits apply deterministically; overlapping replacement, delete/modify, ambiguous insertion boundaries, unsupported encoding, 1 MiB inputs/outputs, or four-million-cell work bounds withhold the whole file. JSON/keybindings/executable code is not generic text. Syntax-level merging cannot establish semantic correctness.

## Review regression audit

The first review follow-up rechecked its six findings against the installed Pi runtime and the current PR head, not their severity badges. Session fixtures enumerate every builtin message/entry discriminant, system/tool transitions, pending/deferred assistant records and provider-scoped tool IDs. Public `SessionManager` fixtures verify retain-none compaction self-references, re-edit root entries and branch-summary root sentinels; forward references, damaged payloads and divergent byte histories still remain withheld.

Partial artifact persistence now follows approved review and fresh local, baseline, owner/config and remote-head checks. Cancelled or stale transfer reviews do not create new conflict artifacts and preserve existing evidence. A manual no-transfer inspection may still persist referenced conflict state; uncertain failures after approved persistence retain evidence rather than pruning unproven records. Automatic new-transfer plans stop at unresolved conflicts even when partial sync is enabled. All content and reviewed-resolution protection checks use the already resolved session root.

Raw collision participants must all be represented in the managed plan (including accepted-baseline paths now absent on both sides) before partial withholding is allowed. Unmanaged case aliases, unmanaged ancestor/descendant paths and cross-policy collisions remain barriers. Managed collision groups still preserve both sides, including explicit absence. The conflicts route now completes `--setup` and known setup values, but does not offer unsupported bypass flags.

Verification: `content-merge.test.ts`, `partial-sync.test.ts` and `sync.test.ts`; the new regressions produced 23 failures on the reviewed source and pass with the fixes. Semantic audits cover cancellation, after-await ownership/freshness, immutable prefix/reference handling, the full collision path set, portable acceptance ordering and retained evidence. No default, model-visible prefix, resource activation or automatic session-resume behavior changes.

### Subsequent review evidence

The next five findings are independently verified and covered by public session-ID grammar fixtures, committed partial-recovery fault injection, connected-closure equivalence/scale tests, bounded preview tests and manager dispatch/cancellation tests. The new header predicate mirrors Pi's public alphanumeric-ended grammar (including internal dots and long IDs), separately from generated entry IDs.

Recovery permits baseline-only absent paths only with the pinned previous-state fingerprint and matching retained artifact group/hash evidence. Unknown paths and forged group membership still refuse recovery; restart rolls forward without republishing or resurrecting equal deletions.

Indexed identity/ancestor/resource/include edges replace pairwise grouping rescans without changing conservative closure. Group/hash indexes also replace repeat scans in artifact reuse and journal verification. The 16,384-independent-conflict scale fixture completed in 18 ms in one local run and normalizes each path once; this measurement is not a timing guarantee.

Preview indexes each version once, enforces cumulative raw display bytes before decoding/appending, preserves exact line endings and binary fallback, and leaves raw evidence unchanged. Compact sanitized labels avoid listing every path before group selection. Artifact loading/verification still reads the bounded private record; the display budget prevents additional whole-group materialization, not that required verification.

The manager conflicts action dispatches direction/selection decisions through the existing sync-origin reviewer and propagates cancellation/closure. Targeted tests reproduced 13 failures on the preceding reviewed source; fixed fixtures remain under the existing 5,000 ms timeout. No defaults, model-visible prefix or activation behavior changes.

## PR #1459 feedback ledger

Every inline item was classified against the current branch and the installed Pi implementation; review-summary and conversation comments contain no additional requests. The first eleven items are **already addressed by current code** and their threads were replied to and resolved before this follow-up:

| Inline comment | Evidence |
| --- | --- |
| 4187925529 valid v3 records | `45fbff77`, `content-merge.test.ts` Pi writer/system/compaction fixtures |
| 4187925535 cancelled artifact writes | `45fbff77`, `partial-sync.test.ts` repeated cancellation |
| 4187925541 startup conflict barrier | `45fbff77`, automatic partial-conflict regression |
| 4188176574 effective session root | `45fbff77`, external loaded-session protection |
| 4188176583 unmanaged collisions | `45fbff77`, unmanaged/cross-policy collision regressions |
| 4188176594 setup completions | `45fbff77`, `sync.test.ts` route completions |
| 4190474935 dotted IDs | `8f6f2aa5`, public session-ID grammar fixtures |
| 4190474942 absent recovery paths | `8f6f2aa5`, pinned baseline-only deletion recovery |
| 4190474952 grouping complexity | `8f6f2aa5`, 16,384-conflict grouping fixture |
| 4190474960 preview materialization | `8f6f2aa5`, bounded preview/decoder fixtures |
| 4190474965 conflict-route dispatch | `8f6f2aa5`, RPC manager route/review tests |

Four later findings were **actionable and not yet addressed** at the preceding head; this follow-up implements them:

| Inline comment | Change and verification |
| --- | --- |
| 4190830248 transactional `sessionDir` | The original v4 postimage fix is superseded by main's v7 settings-root transition evidence; reviewed and backup settings authorize either transition root, while explicit-manager and current-session barriers remain. `snapshot-transaction-recovery.test.ts` covers old-root and malformed-postimage interruption; `recovery-durability.test.ts` covers manager mismatch and newer bytes. Unsupported old evidence remains manual rather than guessed. |
| 4190830255 reused artifact group | New artifacts contain only newly assigned groups and their version/ancestor files; unchanged groups keep their original token. `partial-sync.test.ts` verifies both tokens, membership and file subsets after a changed-group transfer. |
| 4190830258 content lookup complexity | Indexed local, remote, ancestor, protected and decision paths once per plan, without changing merge eligibility; existing content/partial fixtures and full package suite exercise both text and session paths. |
| 4190830261 reviewed collisions | Distinguish mutually exclusive case aliases from simultaneous physical aliases, check protected preimages and selected final layout, reject unknown directory contents, delete reviewed preimages before replacing them and recreate parent directories after removal. `partial-sync.test.ts` exercises remote case rename and both file/directory transitions; `merge-target-safety.test.ts` retains active-session and cross-root alias refusals. |

No new question, superseded finding, or conflicting/incorrect request was identified. Semantic audit: all four changes preserve owner/cancellation checks at publication and destructive boundaries, keep newer/unrecognized bytes and journals rather than overwriting them, and do not change extension settings reads/writes, model-visible prefixes, UI keybindings or activation. Arbitrary concurrent external writer CAS, live providers, Windows and compiled startup remain unverified.

## Concurrent stack integration

Phase 3 includes the latest Phase 2 portability fixes and the latest Phase 1 target-identity/session-root/recovery hardening, without rewriting either other feature branch. Physical pre-publication/recovery guards compare raw local images, while accepted cache/state remains a portable projection. Version-5 setup/connection CRUD and menus preserve the new schema; all transport validators, including Git manifests, accept the deliberate snapshot-v3 barrier. Shared backend-contract fixtures now exercise both v2 and v3 round trips on Git (both publication paths), S3 and WebDAV, and settings-manager fixtures exercise versions 3, 4 and 5.

## Versioned state and transitions

| Boundary | Local content | Remote publication | Accepted state / recovery |
| --- | --- | --- | --- |
| Default policy | Existing file/optional settings strategy | Existing complete snapshot | Existing acceptance semantics |
| Partial plan with conflicts | Preserve every withheld local path, including additions and physical machine-local settings | Complete v3 snapshot retains every observed withheld remote path, including absence | v3 progress state retains withheld hashes/ancestors; Last observed advances separately; Last applied remains the last fully accepted snapshot |
| No independent transfer | No content mutation | No redundant publication once v3 barrier is present | Deduplicated conflict references and observed head persist; no unresolved baseline advancement |
| Proven pre-commit race | No local install | Finite re-read/replan retry under backend CAS/lease | Private immutable evidence retained/reused by content identity |
| Unknown publication / apply / state failure | Guarded preimage/postimage roll-forward only | Verify candidate/head; never blindly republish | Journal and backup retained; cache staging precedes state; unresolved artifacts are verified before recovery |
| Explicit group resolution | Chosen complete local/remote group, including reviewed deletion | Preserve all other unresolved remote groups | Compare reviewed artifact fingerprint, bytes, baselines, policy, owner and observed revision; retire resolved references only after durable acceptance |
| Newer local or remote bytes | Refuse stale choice/install | No unreviewed overwrite | Refresh sync and review; preserve evidence |
| Disable / downgrade | No undo or reload | No historical erasure | Re-enable partial or review a full forced direction; keep evidence; older settings/snapshot readers refuse new formats |

Settings v5 explicitly gates content/partial booleans; partial publication uses snapshot v3, including the first metadata-only barrier when content hashes are otherwise unchanged. v4 local-field behavior and legacy absent policy remain intact. Legacy directional force operations are still whole selected-copy acceptance, not deferred group resolution; their reviewed journal-archive behavior is unchanged.

Dependency grouping includes canonical case/Unicode aliases, ancestor file/directory transitions, and an entire prompts/skills/extensions/themes resource root when any member conflicts. Unproved selection, malformed bytes/metadata, unauthorized filesystem layouts and invalid settings remain global barriers rather than being invented into safe groups. Active loaded-session aliases cannot be resolved from that session; external Pi/editor writers have no arbitrary content CAS guarantee.

## Evidence and private retention

Accepted ancestors are identity/fingerprint/hash checked and never invented from independently edited current content. Staging carries old evidence only where its hash is still the accepted withheld hash. Private artifacts contain baseline content where verified, both logical versions and explicit absence, grouping and observation; unavailable ancestors are labelled unavailable, not absent. They use opaque content identities, immutable reuse, 0600 files / 0700 POSIX directories and bounded atomic JSON publication under denied storage. They are not resource files or portable payloads. Exact requested review is capped at 2 MiB; larger groups require private/manual inspection and a reviewed direction.

After durable acceptance and journal retirement, completed cleanup retains at most 32 unreferenced artifacts whose paths are proven common against accepted/local/remote images and equal one recorded choice. Pinned unresolved records, unknown schemas, corrupted evidence and unproved orphan records are retained. Per-record bounds are not a promise of a total unresolved-history quota.

## Verification map

- `content-merge.test.ts`: deterministic/equal/overlapping hunks, deletion/modification, CRLF, no final newline, binary/invalid UTF-8, size/complexity bounds; equal/comparable sessions, divergence, malformed/partial/blank records, old/future formats, changed header/identity, duplicated ids and broken references.
- `partial-sync.test.ts`: real orchestration with accepted cache; both withheld images and old baseline surviving restart, local-only dependency members, remote collisions with independent progress, missing ancestors, stale bytes/artifact fingerprints, explicit deletion without resurrection, partial state-write failure and guarded recovery without republishing, three-machine interleaving/convergence and stable conflict identity, RPC cancellation, private modes, pinned/unknown retention and completed cleanup.
- Existing `merged-sync`, `merge-review`, automatic-transfer, settings/local-field, transaction recovery, all backend publication/CAS/unknown-outcome suites, generated-runtime and Jiti tests remain the shared protocol/lifecycle regression gates. Exact review keeps their non-default-keybinding, non-interactive rendering, cancellation and hard Ctrl+C contracts.

Scheduling evaluation measured two repeated unchanged-head partial operations: **two verified remote reads, zero publications, zero new artifacts**. Revision-only shortcuts would save those reads but cannot prove mutable content equality; no watcher/debounce/polling is added. The artifact identity optimization reduces repeated identical evidence to one record without skipping content/head revalidation. There are no new timers or watcher disposal obligations.

Repository check/test, package build/pack/tarball, generated lazy-boundary Jiti and isolated RPC smoke evidence is recorded in the Phase 3 PR. Live Git/WebDAV/S3/R2 providers, Windows filesystem persistence and compiled-binary startup remain unverified; deterministic backend contracts replace live-provider claims. The safe session strategy is intentionally narrower than Pi's repair-tolerant reader, and very large/private/unsupported conflict groups remain manual paths.


## PR #1459 final integration and review

Current main is merged without dropping either branch's safety fixes. Snapshot v3 preserves absent portable policy and validates explicit local-field rules and portable-content integrity; accepted projection normalization, legacy-selection review, apply-only head races, completed acceptance, replacement retirement, case queues, completed cleanup, and startup cancellation/settings freshness retain main's contracts. Partial acceptance continues to carry its previous-state and artifact evidence through every completion check. BOMs in terminal previews follow the shared sanitizer's visible replacement policy; raw artifact bytes remain unchanged.

| Inline comment | Outcome and verification |
| --- | --- |
| 4191966254 explicit manager root | Main's session-target ownership check accepts the supplied exact manager root independently of settings, while rejecting mismatches and protecting the loaded session. A fresh interrupted-apply regression in recovery-durability verifies an external manager root with settings containing no sessionDir. |
| 4191966257 large settings postimage | New v7 transitions store the reviewed postimage in a private fsynced settings-after sidecar before journal publication; the settings entry's afterImage pins its hash and root. Legacy inline evidence remains readable, and missing postimages remain null. Root-transition-images verifies a 25 MiB postimage, compact metadata, private permissions, successful authorization and tampered-byte refusal; existing deletion, malformed-evidence and lifecycle tests remain applicable. |
| 4191966264 selected-file scans | Reviewed resolution indexes selected files once; both local and remote 4,096-path group regressions reject any per-decision array find and verify every selected hash. |
| 4191966269 crashed staging trees | File, directory and symlink recovery stages use transaction-derived sibling names. A durable entry marker precedes copying; restart removes only marked stages under safe parents and target queues, including when a target is already restored. Unmarked existing paths refuse ownership. Partial/complete copy crash fixtures suppress cleanup, restart recovery and verify no staged copy or transaction remains. Old random or unknown copies are not guessed or removed. |
| 4191966271 colliding ancestors | Ancestor staging omits all collision participants from the accepted snapshot, including case/Unicode aliases and file/descendant groups; their ancestors stay unavailable rather than blocking accepted-state persistence. Independent eligible paths remain cached. Case and descendant regressions verify both omissions and independent availability. |

Semantic review covers durable sidecar-before-journal ordering and failure retention; hash/root identity and legacy null/inline compatibility; staging ownership, safe-parent checks, task cancellation and queue release; ancestor reader/pruner equivalence; selected-file indexing and unchanged group freshness; settings opt-in/default/version preservation; UI cancellation, disposal, session replacement and shutdown through existing Pi/Kit flows. No model prefix, activation, dependency or public entrypoint changes. Arbitrary external-writer CAS, old unowned staging cleanup, native case-insensitive storage on this Linux host, Windows, physical power loss and live storage transfers remain unverified or unclaimed.

Verification: npm run check passed; the full npm test gate passed with 530 files, 7,323 passed tests and one native case-insensitive filesystem skip. The whole-package run also passed (108 files, 1,970 tests) before the final absent-policy regression and seven backend-contract cases were added; those pass in the final root gate. Package build and pack passed; the inspected 230-file tarball contains source, generated runtime, README, license and package docs, without tests. An isolated offline Pi RPC package-directory smoke passed readiness, sync registration, lazy /sync status and EOF shutdown without an agent run or provider request. npm install preserved manifests and lockfile and reported five audit findings (three high, two critical); no blanket audit fix or publication was performed.


## Review of e933c342

The head, base, complete diff and applicable instructions are unchanged from the prior audit. Twenty earlier inline findings remain addressed; their existing replies need no duplication. The new submitted review and updated conversation summary are informational wrappers for four new inline findings.

| Inline comment | Independent evidence, scope and severity | Outcome |
| --- | --- | --- |
| 4197683654 descendant deletion order | P2, in scope: this PR adds reviewed directory-to-file merged apply. Snapshot planning inserts a parent deletion while scanning its first child, but merged apply iterates that insertion order and requires an empty directory. Multiple siblings stall after publication; nested intermediate directories have no snapshot entry and remain forever. | Implemented: reserve exact intermediate-directory queues, delete descendants deepest-first, and remove only verified empty intermediates before their replacement parent. Regression classes cover siblings, nested trees, partial failure/cancellation, unknown files/directories, and complete postimage acceptance failure without republishing. |
| 4197683667 unresolved automatic pushes | P1, in scope: this PR adds unresolved state whose old accepted hashes intentionally survive. Shutdown's pre-existing autoPushSessions calls the full push path with auto/yes and no force; remote hash equality can pass its old conflict checks and whole-state publication drops unresolved references. The same newly exposed whole-direction acceptance class must be audited in pull and rollback. | Implemented: push/pull refuse unresolved state unless manually forced; automatic force cannot bypass the guard, and rollback's compatibility flag cannot act as a recovery direction. Entry and precommit state checks retain references added during awaits. Shutdown, unchanged remote hashes, forced-direction controls, and callback-added progress are covered. |
| 4197683684 withheld assembly scan | P2, in scope: this PR performs local.files.filter for every withheld decision while assembling the complete local projection, making a wide resource group quadratic before review. Exact missing-path semantics are an empty result, not a deletion decision or invented content. | Implemented: acceptedMergeFiles indexes exact local paths once and preserves decision order, bytes and explicit absence. Equivalence fixtures cover accepted remote/merged/deleted versions and case-distinct paths; a 16,384-file test rejects any per-decision local filter. |
| 4197683697 carried ancestor scan | P2, in scope: partial acceptance introduced a previous-ancestor carry loop with files.some per retained ancestor after publication/apply. It adds quadratic membership work before durable state/journal retirement. | Implemented: stageMergeBaseline creates a staged-path set once and updates it on carry. A near-bound cache regression rejects candidate some scans, retains missing-current accepted ancestors without duplication, and excludes deleted/mismatched hashes. |

Applicable MUST rules and verification methods: serialize every owned file mutation with Pi queues (Test/Review), revalidate cancellation/session ownership after filesystem and persistence awaits (Test/Review), preserve private atomic persistence and failure evidence (Test/Review), retain opt-in/default settings and supported command-mode safety (Test/Review), and run builds/Biome/boundaries/types plus the separate root test gate (Validator/Test). Existing extension-conventions and extension-settings guides remain authoritative; no new setting, custom UI, keybinding, background task or model-prefix transition is planned.


Verification for this follow-up: npm run check passed; npm test passed 533 files with 7,346 tests and one native-filesystem skip. The three new regression files contain 23 tests. Restoring the reviewed implementations reproduced 17 failures among the initial 22 tests (the new projection helper was switched to its equivalent old filter loop for that counterfactual); restoring the fixes passed those tests, and the added installed-postimage acceptance-failure test passed separately. npm run package:pack -- sync and a direct tarball inspection passed (230 files, expected runtime/source/documentation, no tests); all 36 active package README heading audits passed. An isolated, readiness-synchronized offline Pi RPC smoke passed extension registration, lazy /sync status and EOF shutdown without an agent run.

The complete-class semantic audit covers all full directional state writers (push, pull, rollback and syncBoth delegation), automatic force rejection, exact directory queues, safe ancestor identities, empty-only pruning, interrupted and installed-postimage retry, and every remaining scan in the touched source. Remaining filters/some calls are single passes rather than per-file membership loops. New filesystem mutation checks retain cancellation/session ownership after the lstat await; queue scopes unwind on failure. No new setting, persistence format, UI flow, loader task or model-visible prefix transition was introduced. README guidance and the existing Changeset document the new refusal policy.

There are no deferrals, clarification requests or blocked fixes. Native case-insensitive storage, Windows execution, physical power loss, live storage transfers and arbitrary external-writer CAS remain unverified; deterministic tests, the existing native skip and private-evidence preservation do not claim those guarantees. The four thread outcomes are eligible for publication and resolution only after this validated source is pushed.


## Review of 3e1f16c8

The checkout, head/base, description, complete commit/diff evidence and applicable guides remain unchanged. CI now succeeds. Twenty-four previous findings remain addressed. The new submitted review and completed-review summary merely wrap two new inline findings.

| Inline comment | Independent evidence, scope and severity | Outcome |
| --- | --- | --- |
| 4198077693 cumulative text work | P2, in scope: this PR introduces resolveContentConflicts, which applies two quadratic LCS grids to each both-changed text file. Its per-grid cell cap does not bound aggregate work or the nested hunk-comparison loop, and publication retries can repeat all work. | Implemented: one eight-million-unit budget spans both grids, hunk comparisons, all text conflicts and backend retries. Line IDs make charged cells fixed-size comparisons; exhausted paths remain conflicts. Tests cover shared reservations, hunk exhaustion, per-file/encoding refusal and pre-reservation/DP-boundary cancellation. |
| 4198077709 no-transfer artifact races | P2, in scope: this PR introduces partial evidence publication before no-transfer remote-head acceptance. The artifact can survive an error without any state/journal reference, and completed-only pruning deliberately cannot prove it disposable. The same creation-to-reference gap occurs on cancellation and errors before transfer journal publication. | Implemented: no-transfer acceptance checks the head before creation, then refreshes local/state/head before acceptance. Atomic no-clobber linking registers exact inode/size/content ownership before further awaits. The attempt finalizer releases only newly owned files absent from verified state/journal references; existing, replacement, unreadable or ambiguously referenced files remain protected. Tests cover head/local/baseline/settings/cancellation/session races, state-write failure, pre-existing/replacement evidence, successful acceptance and journal recovery. |

Touched-area MUST rules: preserve fail-closed conflict semantics and existing opt-in settings (Test/Review); revalidate mutable local/state/head and session ownership after prerequisite awaits (Test/Review); cancel owned work and release owned resources on failure, cancellation and replacement (Test/Review); use atomic private persistence, protect invalid/unknown files and audit publication/failure ordering (Test/Review); preserve the model-visible prefix (Review); validate builds, formatting, boundaries/types, separate root tests, packaging and Pi Jiti lazy loading (Validator/Test/Smoke). The unchanged extension-conventions, extension-settings and README-conventions guides remain applicable. No new setting, UI, background task or provider protocol is planned.


Verification: npm run check passed after correcting import/declaration lint; npm test passed 535 files with 7,363 tests and the existing native-filesystem skip. Seventeen new regressions passed. Seven targeted regressions failed with the reviewed algorithms restored (only the new budget constant was exported to keep test imports loadable), and all seventeen passed again after restoring the fixes. npm run package:pack -- sync, direct inspection of the 231-file tarball, all 36 active README heading audits and an isolated readiness-synchronized Pi RPC registration/lazy-status/EOF-shutdown smoke passed without a model run.

Complete-class semantic audits: the shared budget is created outside the retry loop; both grids reserve before allocation; every hunk-pair comparison is charged; long line equality is interned to IDs; aborts propagate instead of becoming merge conflicts; and unsupported/exhausted text never advances a withheld baseline. One finalizer covers all artifact-creation-to-reference gaps, including no-transfer failure, cancellation/session replacement, pre-journal failure and verified retry retirement. New artifacts use no-clobber links; ownership is registered before validation/fsync awaits; cleanup checks captured root, inode, size, content and durable state/journal references. Failed or invalid reference/ownership reads retain evidence rather than mask the original error or guess. The finally block only reindents the existing retry body; the whitespace-insensitive diff was audited separately. No setting, artifact/state format, model-prefix transition, custom UI or background task changed. The existing experimental warning/defaults and immutable prior evidence remain intact.

No items are deferred, require clarification or remain blocked. Windows/native case-insensitive execution, physical power/process loss during the creation/reference window, live storage transfers and arbitrary external-writer CAS remain unverified; this change does not claim durable cleanup of unknown crash leftovers. Published source and replies remain prerequisites to resolving the two threads.
