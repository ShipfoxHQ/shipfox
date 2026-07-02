---
"@shipfox/client-test-setup": patch
"@shipfox/client-api": patch
---

Add `resetApiClient()` and a shared `@shipfox/client-test-setup` package whose `installClientDomTestEnv()` makes client `dom` Vitest projects isolation-safe: it registers per-test DOM cleanup and API-client reset and installs the jsdom stubs, so a package can run its `dom` project with `isolate: false` without state leaking across files.
