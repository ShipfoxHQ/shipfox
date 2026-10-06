---
"@shipfox/api-integration-clickup": patch
---

Connecting a ClickUp workspace that is already linked to the same Shipfox workspace now replaces the stored grant and webhook instead of failing with `clickup-installation-already-linked`. The error still applies when the ClickUp workspace belongs to another Shipfox workspace.
