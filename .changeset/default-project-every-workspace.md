---
"@shipfox/api-projects": minor
"@shipfox/api-projects-dto": minor
"@shipfox/api-agent": minor
"@shipfox/api-server": minor
"@shipfox/client-projects": minor
"@shipfox/client-onboarding": patch
---

Gives every workspace a default project that answers the Slack and Linear requests no other agent claims.

- **Projects:** a new workspace gets an empty managed project named Default. `POST /admin/projects/default-backfill` gives one to every existing workspace that isn't deleted and fills the missing config repository owners and names. A renamed default keeps its flag. `createProjectsModule` now takes a `workspaces` client.
- **Contract:** projects carry `is_default` (`isDefault` between modules), and `getDefaultProject` returns the default project of a workspace.
- **Agent:** an unclaimed request starts a conversation in the default project, not the oldest one. A workspace the backfill hasn't reached has no default project, so its unclaimed requests are dropped as `no-project`. Run `POST /admin/projects/default-backfill` after you deploy.
- **Client:** the projects hub, the project switcher, the project breadcrumb, and the project settings show a Default badge. The setup gate ignores the default project when it checks whether a workspace has a project.
