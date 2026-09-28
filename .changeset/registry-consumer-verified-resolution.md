---
"@shipfox/api-registry-dto": minor
"@shipfox/api-registry": minor
"@shipfox/api-server": minor
---

Adds the Registry module. It resolves registry package versions through an inter-module contract. It returns a version only when a trusted key signed it and its content matches the signed digest. It caches verified versions and checks them again on every read. Set `REGISTRY_URL` and `REGISTRY_TRUSTED_KEYS` to turn it on.
