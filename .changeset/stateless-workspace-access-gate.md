---
"@shipfox/api-auth-context": patch
"@shipfox/api-workspaces": patch
"@shipfox/api-integration-core": patch
"@shipfox/api-integration-webhook": patch
"@shipfox/api-integration-gitea": patch
"@shipfox/api-integration-github": patch
"@shipfox/api-integration-sentry": patch
"@shipfox/api-secrets": patch
"@shipfox/api-projects": patch
"@shipfox/api-agent": patch
"@shipfox/api-runners": patch
---

Make the workspace-membership gate stateless. `requireWorkspaceAccess` now lives in `@shipfox/api-auth-context` and authorizes a request purely from the verified session-token claims, replacing the `requireMembership` gate in `@shipfox/api-workspaces` that read the workspace row from the database on every workspace-scoped request. Membership and role already travel in the token, so the check needs no database access.

This removes the per-request database read and severs the runtime dependency on `@shipfox/api-workspaces` from feature modules that only needed the membership gate (integration providers, secrets, projects, agent, runners). Workspace existence and `active`-status enforcement, which no code path currently exercises, moves off the hot path; enforce it at token issuance when workspace suspension is introduced.
