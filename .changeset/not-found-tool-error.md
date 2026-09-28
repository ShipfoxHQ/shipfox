---
"@shipfox/api-integration-spi": minor
"@shipfox/api-integration-core": minor
"@shipfox/api-integration-linear": minor
"@shipfox/runner-agent": patch
---

Adds a `not-found` integration provider error reason. The tool gateway keeps it as the tool call error code instead of `unknown`, and does not report it as an unexpected failure. Linear tool errors for a missing record, or one the token cannot see, now carry it.
