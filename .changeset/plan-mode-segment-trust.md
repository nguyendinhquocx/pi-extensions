---
"@narumitw/pi-plan-mode": minor
---

Restrict `safeSubcommands` trust to individual parsed Bash and PowerShell segments. A matching prefix no longer exempts trailing commands or bypasses the shell parser: every segment must pass its own policy, and unsupported syntax such as redirects and multiline input remains blocked.

This is a compatibility change from full-command trust. Simple configured commands and trusted arguments remain supported, but chains require each additional segment to be independently permitted. Run workflows requiring parser-unsupported syntax outside Plan mode after review. The settings schema is unchanged, and explicitly trusted commands and their arguments can still mutate data or execute code; this setting is not a read-only guarantee or sandbox.
