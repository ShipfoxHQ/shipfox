---
"@shipfox/api-integration-spi": minor
"@shipfox/api-integration-core": minor
"@shipfox/runner-agent": patch
---

Adds a `not-found` integration provider error reason. The tool gateway keeps it as the tool call error code instead of `unknown`, and does not report it as an unexpected failure.
