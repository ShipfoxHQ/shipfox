---
"@shipfox/api-integration-core": patch
"@shipfox/api-runners": patch
---

Runs the API runners and integration core test suites without per-file Vitest module isolation, removing runner auth-helper mocks and cleaning up module-reset handling for shared test modules.
