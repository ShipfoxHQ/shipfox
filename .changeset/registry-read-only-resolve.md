---
"@shipfox/api-registry": minor
"@shipfox/api-registry-dto": minor
---

`resolveVersion` takes an optional `persist` flag. With `persist: false`, it reads and checks the cache as before, but it does not store a fetched version or delete a cached version that fails verification.
