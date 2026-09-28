---
"@shipfox/api-definitions": minor
---

`DEFINITION_ACTIONS_ENABLED` controls whether workflow definitions accept action steps (`uses`). It defaults to `false`, and to `true` when `NODE_ENV` is set to a value other than `production`. Definition validation, sync, and dev runs read it. Until action steps are normalized, a parsed `uses` step fails validation with "not supported yet".
