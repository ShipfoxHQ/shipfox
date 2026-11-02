# Shipfox API Projects

Shipfox API Projects manages project resources and their source repository bindings.

## What it does

- **`createProjectFromSource`**: Creates a project from a repository in an integration connection.
- **`createManagedProject`**: Creates a project whose config lives in a repository Shipfox hosts, with optional seed files.
- **`updateProjectDetails`**: Changes a project's name or slug and writes the update event.
- **`createProjectRoutes`**: Mounts project and administrator HTTP routes.
- **`Project`**: Represents the project identity, URL slug, source repository, and timestamps.

## Installation / Setup

```sh
pnpm add @shipfox/api-projects
```

The module needs an integrations client to resolve the source integration
connection and an Auth client for module setup.

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

## Behavior Notes

A create body with `source: {kind: 'managed', files?}` makes a project with no
repository. The `managed-config-repos` workspace flag gates it, and it defaults
to off: a workspace without it gets `422 managed-source-unavailable`. The
project asks Integrations for the repository first, because every project row
needs a source, then inserts the row with the same id. A project insert that
fails afterward leaves a repository with no project, which costs one commit.
`files` is the tree of the first commit and must stay under `.shipfox/`; a
refused file returns `422 invalid-source-file` with the path. The project DTO
derives `source.kind` from the repository id, so no column holds it.

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
