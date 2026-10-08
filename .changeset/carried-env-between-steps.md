---
"@shipfox/actions": patch
---

Documents `SHIPFOX_ENV` and `SHIPFOX_PATH` for actions: the runner sets both files, and the values reach the steps that follow, even when the action fails.
