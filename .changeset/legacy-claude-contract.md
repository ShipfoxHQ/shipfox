---
"@shipfox/api-agent-dto": major
"@shipfox/api-agent": major
---

Removes the obsolete `claude.auth_token` field from the managed runtime contract and uses the shared API credential for Claude authentication. Runners using the pre-cleanup schema must be upgraded before an API release that omits this field is deployed. This cleanup has no static-credential fallback. If a pre-cleanup runner must be restored, restore or roll back the API release first.
