# Shipfox API Integration Managed

Shipfox API Integration Managed stores a project's `.shipfox/` tree in a git
repository in Postgres and reads it through `SourceControlProvider`.

## What it does

- **`ManagedSourceControlProvider`** resolves repositories and refs, lists
  files, reads files, and lists the commits that changed a path.
- **`db`, `closeDb`, and `migrationsPath`** give the composing module the
  package's database and its migrations.

The provider has no checkout. Runners can't read a managed repo, and there is no
`git clone` or `git push`.

## Installation and setup

Add the package to a workspace package:

```json
{
  "dependencies": {
    "@shipfox/api-integration-managed": "workspace:*",
    "@shipfox/api-integration-spi": "workspace:*"
  }
}
```

The provider needs no configuration. It uses the API's Postgres connection.
Apply the migrations in `drizzle/` under the migration table
`__drizzle_migrations_integrations_managed`.

## Usage

```ts
import {ManagedSourceControlProvider} from '@shipfox/api-integration-managed';
import type {IntegrationConnection} from '@shipfox/api-integration-spi';

declare const connection: IntegrationConnection<'managed'>;
const externalRepositoryId = 'managed:01890000-0000-7000-8000-000000000001';

const provider = new ManagedSourceControlProvider();
const {commit} = await provider.resolveRef({connection, externalRepositoryId, ref: 'main'});
const file = await provider.fetchFile({
  connection,
  externalRepositoryId,
  ref: commit,
  path: '.shipfox/workflows/triage.yml',
});
```

## Data model

The `integrations_managed` namespace owns three tables. Refs and objects
cascade from their repository, so deleting a repository is one statement.

| Table | Holds |
| --- | --- |
| `integrations_managed_repositories` | One repository per project, with its workspace. |
| `integrations_managed_refs` | Branch names and their commit. A foreign key ties each ref to a commit object in the same repository. |
| `integrations_managed_objects` | Standard deflated git objects, by repository and object id. |

## Behavior notes

A repository id is `managed:<uuid>`. Every read checks that the repository belongs
to the connection's workspace, and answers `repository-not-found` if not.

| Method | Behavior |
| --- | --- |
| `listRepositories` | Lists the workspace's repositories. `search` matches any part of the full name. |
| `listFiles` | Sorted by path. `type` is `file`, `symlink`, or `submodule`, and `size` is `null`. The cursor is the last path. |
| `fetchFile` | Reads a file at a branch or a commit id. A symlink or a submodule answers `file-not-found`. |
| `resolveRef` | Accepts `refs/heads/x` and `x`. Tags don't exist. |
| `listCommits` | Follows first parents from a branch or commit id, and keeps a commit when the path's object or mode differs from its first parent. |

**`listCommits` can return a short page.** One page walks at most 500 commits, so
a rarely changed path can return fewer commits than `limit`, or none, with a
`nextCursor`. Keep reading until `nextCursor` is `null`.

**A `listCommits` cursor belongs to one head commit.** A cursor from another head
answers `provider-rejected`, so pin `ref` to a commit id to page through a branch
that can move.

**Git library access stays narrow.** `isomorphic-git` only reaches objects. Any
other read reports not found, and any other write throws. Callers resolve refs in
Postgres and pass object ids, so no ref name reaches the library.

**Storage failures stay typed.** A missing object, unreadable object bytes, or a
database failure answers `provider-unavailable` and reports the error.

[ADR 0025](https://github.com/ShipfoxHQ/shipfox/blob/main/docs/adr/0025-managed-config-repositories.md)
records the design.

## Development

```sh
turbo check --filter=@shipfox/api-integration-managed
turbo type --filter=@shipfox/api-integration-managed
turbo test --filter=@shipfox/api-integration-managed
```

The tests need the repository's Postgres service. `src/core/source-control-contract.test.ts`
runs the shared cases from `@shipfox/api-integration-spi/testing`, so a change to
those cases applies here and to the test provider in `@shipfox/api-integration-core`.

## License

MIT
