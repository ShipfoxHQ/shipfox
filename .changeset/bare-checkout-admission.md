---
"@shipfox/api-workflows": patch
"@shipfox/api-integration-core": patch
"@shipfox/api-integration-core-dto": patch
---

Run admission rejects a `repository:` checkout without a connection on a managed project that has no default checkout when the project's default connection is missing or not active. `listSourceControlConnectionIds` also returns `inactiveConnectionIds`.
