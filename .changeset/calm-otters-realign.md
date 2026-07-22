---
"@shipfox/client-agent": patch
"@shipfox/client-features": patch
"@shipfox/client-integrations": patch
"@shipfox/client-projects": patch
"@shipfox/client-runners": patch
"@shipfox/client-secrets": patch
"@shipfox/client-triggers": patch
"@shipfox/client-workflows": patch
"@shipfox/client-workspace-settings": patch
---

Moves workspace-settings and project-workflow route ownership from centralized packages into each feature's own route module, so a feature package declares and ships its own settings pages.
