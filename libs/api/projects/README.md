# Shipfox API Projects

Shipfox API Projects manages project resources and their source repository bindings.

## What it does

- **`createProjectFromSource`**: Creates a project from a repository in an integration connection.
- **`createManagedProject`**: Creates a project whose config lives in a repository Shipfox hosts, with optional seed files.
- **`updateProjectDetails`**: Changes a project's name or slug and writes the update event.
- **`deleteProject`**: Tombstones a project and writes `PROJECT_DELETED`.
- **`createProjectRoutes`**: Mounts project and administrator HTTP routes.
- **`Project`**: Represents the project identity, URL slug, source repository, and timestamps.

## Installation / Setup

```sh
pnpm add @shipfox/api-projects
```

The module needs an integrations client to resolve the source integration
connection, an Auth client for module setup, and the feature flag reader from
`@shipfox/node-feature-flags`.

## Usage

```ts
import {createProjectFromSource} from '@shipfox/api-projects';

const project = await createProjectFromSource({
  actorId,
  workspaceId,
  name: 'Checkout API',
  slug: 'checkout-api',
  sourceConnectionId,
  sourceExternalRepositoryId,
  integrations,
});
```

## Routes / API / Data Model

Routes mount under `/projects` and use UUIDs for resource identity:

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/projects` | Create a project from a source repository, or from a managed source. |
| `GET` | `/projects?workspace_id=<workspaceId>` | List projects in a workspace. |
| `GET` | `/projects/<projectId>` | Read one project. |
| `PATCH` | `/projects/<projectId>` | Update a project's name or slug. |
| `DELETE` | `/projects/<projectId>` | Delete a project. Workspace admins only, never an impersonated session. The body is `{name}`. |
| `GET` | `/projects/<projectId>/access` | Read the project's access. Members can read it. |
| `PUT` | `/projects/<projectId>/access` | Replace the project's access. Workspace admins only, and never an impersonated session. |

The create and update bodies carry the mutable `slug` field. A project slug is
unique within its workspace. A duplicate returns `409 slug-conflict`, while a
repository already bound to a project returns the separate
`409 project-already-exists` error.

| Field | Constraint | Use |
| --- | --- | --- |
| `id` | UUID, stable | API resource identity |
| `workspace_id` | UUID | Workspace ownership |
| `name` | Required display text | Project label |
| `slug` | Required, unique within `workspace_id` | Client navigation and display |
| `source` | `kind` (`managed` or `linked`), integration connection, and repository identifiers | Source binding |

Project slugs are navigation values. The API does not resolve a project from a
slug in a resource path or query. The client resolves a project slug from its
workspace project list, then sends the UUID to the API.

## Access

A project's access lists the connections its workloads can use and, for each connection, the
resources they can reach. Nothing enforces it yet; this module stores and serves it.

- **`connection_access`** on the project is `all` (the default) or `selected`. Only `selected`
  projects have rows in `projects_connection_scopes`, one per listed connection. A scope limited to
  some resources has rows in `projects_connection_resources`, with the provider id, a lowercase
  `lookup_name` for name targets, and the provider's `display_name`.
- **`PUT` replaces everything** in one transaction and writes `PROJECT_ACCESS_CHANGED`, an audit
  event with the actor, the correlation id, and a count of resources per connection. The body is
  `{"connections": "all"}` or
  `{"connections": [{connection_id, resources: "all" | [{kind, external_id}]}]}`.
- **Validation** goes through the integrations client. Each listed connection must belong to the
  workspace, be active, and not be internal. A listed resource must be a `repository` that the
  connection's provider declares and can resolve, or the request answers `422 resource-not-found`.
  The other refusals are `access-connection-invalid`, `access-connection-duplicate`,
  `access-resource-kind-unsupported`, `access-resource-scope-empty`, and `access-limit-exceeded`.
- **Limits** are 100 connections and 1,000 resources per project.
- **The config source counts.** A linked project's config repository counts toward the one-resource
  minimum of its connection, so that connection can hold zero resource rows and still mean "only the
  config repository". The config source is never stored as a resource.
- **`getProjectAccessPolicy` and `getProjectAccessPolicies`** on the inter-module contract return
  the policy that the evaluator in `@shipfox/api-projects-dto` takes. The single read throws
  `project-not-found`. The batch read takes up to 100 ids and leaves out projects it can't find.
- **Connection deletion** removes the connection from every project. The module consumes
  `integrations.connection.deleted` and deletes the matching scopes, which cascades to their
  resources. A repository rename updates the stored `lookup_name` and `display_name` of a listed
  repository through `integrations.source_control.repository_updated`.

## Deleting a project

`DELETE /projects/<projectId>` takes `{name}`, which must equal the project's current name. It
answers `204`. Other answers are `422 project-name-mismatch`, `409 default-project-undeletable`,
`403 forbidden` for a member who is not an admin, and `404 project-not-found`.

Deletion sets `deleted_at` and `deleted_by` on the row and writes `PROJECT_DELETED` in one
transaction. The row stays, because usage reads a deleted project's name and slug from it.

- **Every read filters on live rows**, so a deleted project is missing from the commit on. Two reads
  are the exception: the admin list shows the project with `status: deleted` and `deleted_at`, and
  `getProjectsByIds` shows it with `includeDeleted`.
- **The slug and the config repository can be reused.** `projects_workspace_slug_unique` and
  `projects_source_unique` are partial on `deleted_at is null`.
- **`getProjectsByIds`** on the inter-module contract returns the name, slug, and `deletedAt` of up
  to 100 projects. A deleted project appears only with `includeDeleted`.
- **The module purges its own rows** when it consumes `PROJECT_DELETED`: the access rows and the
  `integration_event_dedup` rows, the latter in batches. Purges by other modules from the same event
  are separate work.

## Behavior Notes

A create body with `source: {kind: 'managed', files?}` makes a project with no
repository. The `managed-config-repos` workspace flag gates it, and it defaults
to off: a workspace without it gets `422 managed-source-unavailable`. The
project asks Integrations for the repository first, because every project row
needs a source, then inserts the row with the same id. When anything fails
afterward, the project deletes the new repository on a best-effort basis. A
failed delete is logged and leaves a repository with no project, which costs one
commit. `files` is the tree of the first commit and must stay under
`.shipfox/`; a refused file returns `422 invalid-source-file` with the problem
and the path. The path is empty when the seed as a whole is over 1 MiB. More
than 100 files fails request validation with `400`. The project DTO derives
`source.kind` from the repository id, so no column holds it.

`moveProjectSource` on the inter-module contract moves a project's config source
from the repository it expects to the target. It locks the project row and
compares the current source, so a repeat call that finds the target already set
succeeds with `moved: false` and writes nothing. Otherwise it updates the source
fields and writes `PROJECT_SOURCE_BOUND` in the same transaction. A source that is
neither the expected one nor the target answers `source-changed`, and a target
that another project already owns answers `source-already-bound`.

The create form derives an editable default slug from the project name. The API
requires an explicit slug and never adds a suffix when the value is taken. A
rename frees the old slug immediately and emits a project-updated outbox event.

Checkout authorization in selected mode reads the persisted source repository
owner and name. The `integrations.source_control.repository_updated` event
refreshes this metadata after provider-side changes. If a provider misses a
webhook, use the project and source identifiers to locate the stale row.
Reprocess the provider event before enabling authorization or retrying checkout.

## Development

```sh
turbo check --filter=@shipfox/api-projects
turbo type --filter=@shipfox/api-projects
turbo test --filter=@shipfox/api-projects
```

For repository test conventions, read the [testing guide](../../../docs/guides/testing.md).

## License

MIT
