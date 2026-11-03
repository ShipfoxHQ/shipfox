---
"@shipfox/api-integration-managed-vcs": minor
"@shipfox/api-integration-core": minor
"@shipfox/api-integration-core-dto": minor
"@shipfox/api-agent-access": minor
"@shipfox/api-agent-access-dto": minor
"@shipfox/api-server": patch
"@shipfox/workflow-templates": patch
---

Agents can write config to a managed project, on branches only. Agent access gains `list_config_files`, `read_config_file`, and `commit_config_changes`; the reads also work on linked projects, and the write answers `repository-read-only` with the repository name for a linked one. The commit creates its branch on first use, refuses the default branch, enforces the path and size rules, and gives one `stale-head` to two racing commits. The create-workflow-from-template skill (revision 15) writes a Shipfox-hosted project's workflow to a branch, tests it, and stops without suggesting a pull request.
