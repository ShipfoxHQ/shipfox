---
"@shipfox/node-module": minor
---

`SHIPFOX_STRICT_PACKAGE_COPIES=true` now fails startup for every package that `initializeModules` reports as installed more than once, even when the copies share their state.
