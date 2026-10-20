---
'@shipfox/api-integration-core-dto': minor
'@shipfox/api-integration-spi': minor
'@shipfox/api-integration-core': minor
'@shipfox/api-integration-github': minor
'@shipfox/api-workflows': patch
---

Adds `provider_access` to a connection that lost access at the provider, either `removed` or `suspended`. Enabling such a connection now returns 409 `connection-provider-access-unavailable`, and a checkout on it tells the runner to unsuspend or reinstall the GitHub App. GitHub reports the access from the installation and no longer returns an external URL after an uninstall.
