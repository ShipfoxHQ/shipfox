---
"@shipfox/api-projects": minor
"@shipfox/api-projects-dto": minor
"@shipfox/api-agent": minor
"@shipfox/api-server": minor
"@shipfox/client-projects": minor
"@shipfox/client-onboarding": patch
---

Gives every workspace a default project that answers the Slack and Linear requests no other agent claims.

- **Projects:** a new workspace gets an empty managed project named Default. A workspace made before this release gets its own when the first page of its project list is read without a search, or when its default project is read, so no backfill step is needed. A renamed default keeps its flag.
- **Contract:** projects carry `is_default` (`isDefault` between modules), and `getDefaultProject` returns the default project of a workspace.
- **Agent:** an unclaimed request starts a conversation in the default project, not the oldest one.
- **Client:** the projects hub, the project switcher, the project breadcrumb, and the project settings show a Default badge. The setup gate ignores the default project when it checks whether a workspace has a project.
