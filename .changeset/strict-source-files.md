---
"@shipfox/api-integration-spi": minor
"@shipfox/api-integration-core-dto": minor
"@shipfox/api-integration-core": patch
"@shipfox/api-integration-github": patch
"@shipfox/api-integration-gitea": patch
"@shipfox/api-definitions": patch
---

Reads source files as strict UTF-8 and lists symlinks and submodules. Fetching a file that is not valid UTF-8 now fails with the `binary-file-unsupported` reason instead of replacing invalid bytes. Source file listings now report `symlink` and `submodule` entries next to `file` entries. Workflow sync ignores those entries and reports a workflow file that is not UTF-8 text as an invalid definition for that file.
