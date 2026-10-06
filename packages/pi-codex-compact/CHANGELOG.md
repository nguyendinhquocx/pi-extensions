# @narumitw/pi-codex-compact

## 0.55.0

### Minor Changes

- f59e6a8: Pause repeated session-route attempts after an exact OAuth compaction rejection without disabling checkpoint replay. Add Checkpoint recovery (default Summarize, optional Cancel): recover opaque history through a bounded normal inference summary, or cancel without replacing history if recovery is unsafe or unsuccessful. Preserve existing auto routing and native fallback for sessions without checkpoints.

## 0.54.0

### Minor Changes

- 4451826: Add experimental opt-in `context-management` compaction through the active Responses provider, including official ChatGPT OAuth on compatible backends. Persist the latest stream-completed checkpoint and its exact safe output suffix, preserving default routing and legacy checkpoint replay. Handle Codex's successful `response.done` terminal event, request stateless reasoning encryption without changing thinking effort or dropping other include fields, and require replayable encrypted reasoning after terminal backfill before publication. Bound and cancel maintenance inference requests, reject partial or unsafe output, and retain native fallback without switching credentials or protocols. Prevent stale session cleanup from clearing replacement-owned status.

### Patch Changes

- 094174c: Explain operation-specific ChatGPT OAuth compaction rejections while preserving Pi-native fallback, existing routes, and opaque checkpoint replay. Redact resolved request credentials from fallback warnings and document safe recovery without claiming remote authorization is fixed.

## 0.53.3

### Patch Changes

- 8abd5b7: Keep generated extension runtime graphs inside Pi's Jiti-loaded TypeScript path to avoid duplicate peer-runtime evaluation during startup. Add measured generated runtimes for Context Management, Herdr, and TypeSafe Search.

## 0.53.2

### Patch Changes

- 67a3049: Adapt provider, transcript, usage, deferred-tool, and telemetry behavior to Pi's current runtime contracts, including accurate cache-warming accounting and exclusion from ordinary generation traces.

## 0.53.1

### Patch Changes

- eeede25: Allow managed npm installs without physical Pi peer packages to open the settings menu.

## 0.53.0

### Minor Changes

- 2edfea9: Support explicit Codex Responses compatibility profiles for custom Pi model APIs, including safe checkpoint replay authorization and migration of earlier checkpoints.

## 0.52.0

### Minor Changes

- ac74542: Add Remote V2 and unary Responses Compact routing for OpenAI Codex, OpenAI, Azure OpenAI, and compatible custom providers while preserving existing checkpoints.

## 0.51.3

### Patch Changes

- Updated dependencies [40182e5]
  - @narumitw/pi-tui-kit@0.59.0

## 0.51.2

### Patch Changes

- 3346683: Publish generated lazy chunks at the JavaScript paths referenced by each extension runtime so deferred menus and implementations load correctly through Pi's Jiti loader.
- Updated dependencies [b9eba3a]
  - @narumitw/pi-tui-kit@0.58.0

## 0.51.1

### Patch Changes

- dadebf1: Clarify that Remote V2 eligibility comes from the active model's `openai-codex-responses` API declaration.

## 0.51.0

### Minor Changes

- 9645603: Detect remote compaction support from the active model's `openai-codex-responses` API capability instead of its provider name, while preserving exact model-ID checkpoint replay across persisted summary wording versions.

## 0.50.2

### Patch Changes

- dc4f90e: Load each extension from a generated source-mapped Jiti runtime while preserving first-use feature boundaries.

## 0.50.1

### Patch Changes

- f16abec: Preserve Codex Remote V2 replay and repeated compaction after session resume when Pi interleaves older compaction summaries with the newest checkpoint's retained messages.

## 0.50.0

### Minor Changes

- 26e91f9: Promote the extension to stable, include it in root Git installations, and remove its experimental startup warning.
