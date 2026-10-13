---
"@shipfox/actions": patch
---

When an action fails and also leaves an invalid `SHIPFOX_ENV` or `SHIPFOX_PATH` file, the step log now has a line naming the rejected file. The original failure stays the step result.
