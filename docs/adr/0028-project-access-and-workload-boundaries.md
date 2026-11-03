# ADR 0028: Project access and workload boundaries

- **Status:** Accepted.
- **Date:** 2026-11-03.
- **Decision owners:** Server architecture, projects, and integrations.
- **Linear issue:** [ENG-3192](https://linear.app/shipfox/issue/ENG-3192/store-and-read-project-access).
- **Related:** [ADR 0002: Server inter-module architecture](0002-api-inter-module-architecture.md),
  [ADR 0006: Database ownership boundaries](0006-database-ownership-boundaries.md),
  [ADR 0017: Full installation access for backend GitHub tools](0017-github-backend-tool-authorization.md),
  [ADR 0025: Managed config repositories](0025-managed-config-repositories.md).

## Context

**A project equals one repository today.** Each repository can belong to one project. Adding a
repository means adding a project.

**Managed config repos removed that rule for new projects.** A managed project can reach every
repository the GitHub App installation sees. That helps onboarding, but no project can say "my
workflows only touch these repositories" or "my workflows only use this Linear connection".

**The narrowing lives on the wrong object.** A connection carries a `repository_access` mode. Its
`selected` mode treats a repository as reachable when any project in the workspace binds it. The
answer depends on other projects, not on the project that makes the call.

**Two more gaps sit next to it.** The project that answers unclaimed Slack and Linear requests is
the oldest one, picked by an invisible rule. Projects can't be deleted, and nothing can stop the
work of a scope.

## Decision

### A project is a workload boundary

**A project holds config, secrets, and cache. Its access lists what its workloads can use.**
Workloads are jobs, tool steps, agent steps, and project agent turns. The projects module owns
access, and it stores no copy of connection state. Access limits workloads. It doesn't limit which
members can see the project.

### Access is per connection, with a generic resource kind

**A project uses all connections, or a list.** Each listed connection reaches all its resources, or
a list of resources of a kind the provider declares. v1 supports one kind, the repository, on
GitHub and Gitea. The default for every project is all connections.

**A provider adds a kind by declaring it.** The provider SPI gains `resourceKinds`,
`listScopeResources`, and `resolveScopeResource`. A provider also fills the resource of its events
and returns the targets of its tool calls. The tables, the evaluator, the routes, and the settings
page don't change.

**One pure evaluator decides every question.** It lives in `@shipfox/api-projects-dto` and stays
browser-safe, so the client uses it too. It takes the project's policy and returns a decision:

- The config source connection and the config source repository always pass.
- A narrowed match returns the matched resource, so callers pin its id. A stale name can't match a
  repository that reused it.
- A linked project's config repository counts toward the one-resource minimum of a selected scope.
- `sourceControlConnectionIds` is an input to the default helpers, because the policy doesn't know
  providers.

### Connections have no repository mode

**Every connection reaches its installation.** The `repository_access` column, its route, and its
audit event go away in a later change. Existing `selected` connections become `all`, and an admin
narrows projects instead. The installation stays the hard limit.

### Checkout revisions key on repository identity

**A checkout picks its revision by the repository it checks out, never by project.** The trigger
commit applies when the trigger's connection and repository match the checkout target. A managed
project's config commit never becomes a code revision.

### Every workspace has one default project

**The default project is flagged on its row and can't be deleted.** It answers unclaimed Slack and
Linear requests, and no other project steps in. Routing reads the flag, never the name, the slug, or
the age of a project.

### Deletion is a tombstone, deletion markers, `stopWork`, then purges

**Deleting a project hides it at once, then each module cleans up.** A tombstone on the project row
makes every read treat it as missing. Each module that owns project rows records a deletion marker
that blocks later writes, because late events would otherwise recreate rows. A reusable `stopWork`
stops running work for a project or a workspace. Purges then delete rows in batches.

**Markers and `stopWork` are the shared way to stop a scope.** Workspace suspension and usage
limits reuse them later.

### This change stores and reads access

**Nothing enforces access yet.** This change ships the SPI, the tables, the evaluator, the
contract, the routes, and the audit event. Enforcement on checkout and tools, trigger filtering,
the default project, and deletion each land in their own change, in the order the Linear project
lists them.

- A connection delete writes `integrations.connection.deleted`, and the projects module removes
  the matching scopes.
- A repository rename updates the stored names of a listed resource.
- `PUT /projects/:projectId/access` replaces both tables in one transaction, checks each resource
  with the provider, and writes `PROJECT_ACCESS_CHANGED` as an audit event.

## Alternatives considered

| Alternative | Why not |
| --- | --- |
| Keep the repository mode on the connection. | The answer depends on other projects, so a project can't state what it needs. |
| Store access in `.shipfox/`. | An admin edits access, not the project's authors, and a pull request can't be the control for who reaches a connection. |
| Make the evaluator a producer operation. | Triggers, workflows, agent, and the client would each pay a round trip for a pure decision over a small policy. |
| Add one table per resource kind. | A new kind would change storage, routes, and the settings page. |
| Pick the default project by name or age. | The rule is invisible, and a rename would move it. |
| Hard-delete a project in one transaction. | Run history spans modules, and late events recreate rows after a purge. |

## Consequences

- The evaluator is a public, browser-safe contract. Changing a rule is a breaking change for every
  caller.
- A selected scope can hold zero rows on a linked project's config connection, and it still means
  "only the config repository".
- Connection and resource ids are opaque, with no cross-module foreign key. A deleted connection
  removes its scopes through an event, so a short window can show a scope with no connection.
- A project left with `selected` access and no scope reaches only its config source.
- Access changes apply on the next call once enforcement ships, with no cache between them.
