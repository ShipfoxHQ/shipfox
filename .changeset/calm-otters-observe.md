---
"@shipfox/api-workflows": minor
"@shipfox/api-workflows-dto": minor
---

Expose step attempts in the read API: the run-detail endpoint now returns `current_attempt` on each step plus its per-attempt history (`attempts[]`, with status, exit code, gate result and restart reason), so a restarted step's attempts are visible.
