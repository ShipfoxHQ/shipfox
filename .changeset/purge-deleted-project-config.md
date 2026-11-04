---
"@shipfox/api-triggers": minor
"@shipfox/api-definitions": minor
"@shipfox/api-secrets": minor
"@shipfox/api-cache": minor
"@shipfox/api-agent": minor
"@shipfox/api-integration-core": minor
---

Purges the configuration and conversations of a deleted project. After a project is deleted, its subscriptions, definitions, secrets, cache entries, conversations, and managed repository are removed, and a late event can't bring any of them back. A write for a deleted project answers `project-not-found`. A repository the project linked is not touched, and action snapshots stay, because projects in a workspace share them.
