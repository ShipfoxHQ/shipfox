---
"@shipfox/worktree-services": minor
---

Worktree leases are 25 ports instead of 20, and `discordApi` moves to offset 20 so it no longer shares a port with the E2E registry. A lease from a 20-port block is replaced with a 25-port block the next time services start, so its ports change.
