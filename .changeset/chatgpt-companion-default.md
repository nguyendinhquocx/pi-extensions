---
"@narumitw/pi-usage": minor
---

Automatically query ChatGPT plan usage through a validated same-account Codex companion login after native OpenAI OAuth verification. Remove the experimental companion setting and confirmation: stored `openaiCompanionUsage: false` no longer disables read-only requests, and obsolete values remain preserved on disk. Remove the companion login to restore web-only reporting; native inference is unchanged.

Hide app used/remaining percentages in reports and the statusline while retaining app reset/window information, allowance caps, and registration validation. Keep safe web-only guidance for missing companion credentials and fail closed without stale quotas on invalid credentials or backend failures.

This intentionally replaces the default-off opt-in with automatic behavior. The source remains experimental and uses undocumented endpoints; only one user-reported plan weekly comparison matched the web, not app values or broader live behavior.
