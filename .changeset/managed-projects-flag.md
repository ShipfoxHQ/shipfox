---
"@shipfox/api-integration-managed-vcs": minor
"@shipfox/api-integration-spi": minor
"@shipfox/api-integration-core": minor
"@shipfox/api-integration-core-dto": minor
"@shipfox/api-projects": minor
"@shipfox/api-projects-dto": minor
"@shipfox/api-server": minor
"@shipfox/api-workflows": patch
"@shipfox/client-projects": minor
"@shipfox/client-workflows": patch
---

Adds projects with a managed repository, behind the `managed-config-repos` workspace flag. `POST /projects` accepts a managed source, the project DTO gains `source.kind`, and the workspace's hidden connection stays out of every list. A job with a default checkout on a managed project now explains how to fix it.
