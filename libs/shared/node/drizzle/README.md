# Shipfox Drizzle

Helpers for using Drizzle with PostgreSQL in Node.js services.

## What it does

- **`drizzle`**: Exports the Drizzle driver for `node-postgres`.
- **`NodePgDatabase`**: Exports the matching database type.
- **`runMigrations()`**: Runs migrations in a transaction. It uses a PostgreSQL advisory lock.
- **`uuidv7PrimaryKey()`**: Makes a UUID primary key with a `uuidv7()` default.
- **Cursor helpers**: Encode, decode, filter, and page through keyset cursors.
- **Deletion markers**: `deletedScopeColumns()`, `recordDeletedScope()`, `assertScopeWritable()`, and
  `ScopeDeletedError` block writes to a deleted workspace or project.
- **`deleteInBatches()`**: Deletes matching rows one committed batch at a time.

## Deletion markers

A module that owns rows for a project keeps its own `<module>_deleted_scopes` table. Declare it
with `deletedScopeColumns()`, and make it unique on `(workspace_id, project_id)` with nulls not
distinct. A marker with no `project_id` covers the whole workspace.

```ts
export const workflowsDeletedScopes = pgTable('deleted_scopes', deletedScopeColumns());

// On deletion:
await db.transaction((tx) =>
  recordDeletedScope(tx, workflowsDeletedScopes, {
    scope: {workspaceId, projectId},
    reason: 'project_deleted',
  }),
);

// In every write to a row that carries project_id:
await db.transaction(async (tx) => {
  await assertScopeWritable(tx, workflowsDeletedScopes, {workspaceId, projectId});
  await tx.insert(runs).values(run);
});
```

`recordDeletedScope()` takes an exclusive advisory lock on the scope, so it waits for guarded writes
in progress. `assertScopeWritable()` takes a shared lock on the workspace and the project, then
throws `ScopeDeletedError` when a marker exists. Every write that starts after the marker commits
sees it. Event consumers treat the error as handled, and routes answer not-found. Run the guarded
transaction at READ COMMITTED, the PostgreSQL default.

`deleteInBatches({db, table, where, batchSize})` deletes in statements that each commit on their
own, and returns how many rows it deleted. It picks rows by physical row id, so it works for tables
with a composite key.

## Installation

Use Node.js 24 or newer. Use PostgreSQL 18.

```sh
pnpm add @shipfox/node-drizzle @shipfox/node-postgres drizzle-orm
```

## Usage

```ts
import {drizzle, runMigrations, uuidv7PrimaryKey} from '@shipfox/node-drizzle';
import {createPostgresClient} from '@shipfox/node-postgres';
import {pgTable, text} from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: uuidv7PrimaryKey(),
  email: text('email').notNull(),
});

const pool = createPostgresClient();
const db = drizzle(pool);
await runMigrations(db, './drizzle', '__drizzle_migrations_users');
```

## Behavior notes

- `uuidv7PrimaryKey()` uses the built-in `uuidv7()` function. That function needs PostgreSQL 18.
- Give each module its own migration table when modules share a database. Their histories stay separate.
- Connect straight to the database for migrations. Do not use a transaction pool or serverless pool.
- The advisory lock lets only one process set up migration tables at a time.

## Development

```sh
turbo check --filter=@shipfox/node-drizzle
turbo type --filter=@shipfox/node-drizzle
turbo type:emit --filter=@shipfox/node-drizzle
turbo build --filter=@shipfox/node-drizzle
turbo test --filter=@shipfox/node-drizzle
```

## License

MIT
