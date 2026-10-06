---
"@narumitw/pi-accounts": patch
---

Fix OpenAI account login failing with "Sign in with ChatGPT requires a device ID (UUID) for this installation". Pass Pi's stable installation device ID to provider login flows, as Pi's `/login` does, in TUI and RPC modes.
