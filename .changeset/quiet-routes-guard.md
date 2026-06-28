---
"@shipfox/client-app-shell": patch
"@shipfox/client-auth": patch
"@shipfox/client-integrations": patch
"@shipfox/client-projects": patch
"@shipfox/client-router": patch
---

Moves workspace setup gating into route hooks so VCS onboarding and first project creation resolve before protected workspace content renders.
