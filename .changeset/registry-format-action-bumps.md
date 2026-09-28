---
"@shipfox/registry-format": minor
---

Adds version rules and derived metadata for actions. `computeActionBump` returns the minimum bump between two action manifests. `diffActionCapabilities` lists the changes to what an action can reach through its integration aliases. `deriveActionMetadata` returns the integrations, capabilities, interface, usage snippet, and size of an action version. An action version document's `derived` field now follows `registryActionMetadataSchema`.
