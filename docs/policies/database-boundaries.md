# Database boundary policy

This policy owns the database rules for the repository. It covers ownership,
access, and names. Read it when adding or changing a table, migration, query,
foreign key, transaction, or module database declaration.

[ADR 0006](../adr/0006-database-ownership-boundaries.md) records why Shipfox
uses owner-only database access. The [backend architecture](../architecture/backend-architecture.md)
owns the current module and inter-module model.

## Assign one owner

**Every stored database object has one owning database module.** The owner
declares and migrates the object. A bounded context can contain more than one
database module. Being in the same context does not grant access to another
module's tables.

Each database module registers one stable namespace. The namespace:

- Uses lowercase snake case.
- Matches the module name when the module has one database.
- Adds a stable qualifier when one module has several databases.
- Does not change when a package or source directory moves.

Examples include `runners`, `workflows`, `email_challenges`, and
`integrations_github`.

**Only the owner reads or changes its objects.** No other module can:

- Select from, insert into, update, delete from, or truncate an owned table.
- Join an owned table or lock one of its rows.
- Add a foreign key, view, trigger, or database function that reads an owned
  table.
- Re-declare an owned table in Drizzle or another query tool.
- Use raw Structured Query Language (SQL) to bypass the ownership boundary.

The application composition root can run every module's migrations. This
permission does not let it query business data.

Named shared infrastructure can own stored data. Consumers still use its public
API. They do not read its tables.

## Name database objects

**Every module-owned table starts with `<database_namespace>_`.** Use the
module's table creator so the physical prefix is not repeated at each
declaration.

```ts
import {pgTableCreator} from 'drizzle-orm/pg-core';

export const pgTable = pgTableCreator((name) => `workflows_${name}`);
```

Use the same prefix for module-defined PostgreSQL types. Start explicit index,
constraint, sequence, view, and trigger names with the table name or namespace.

Use the namespace in the Drizzle migration history table:

```text
__drizzle_migrations_<database_namespace>
```

PostgreSQL system objects and extension-owned objects are outside this naming
rule.

## Cross a database boundary

**Call the owner instead of querying its tables.** Choose the boundary from the
caller's need:

| Need | Boundary |
| --- | --- |
| A current decision or current state | The owner's inter-module operation. |
| A fact committed by the owner | The owner's outbox event. |
| A durable wait, retry, timer, or recovery path | A Temporal workflow and owner-provided activity. |
| Data for reporting or search | An owner-published projection or snapshot. |

Do not expose a database handle, Drizzle schema, row type, query helper, or
transaction through an inter-module contract.

**Transactions do not cross database owners.** One owner performs every change
in an atomic operation. Redesign an operation that needs tables from two
owners. Do not hold one module's transaction open while calling another module.

Store another module's ID as an opaque value when a local record refers to it.
Do not add a cross-owner foreign key. The producer checks its own IDs through
its public operation.

## Migrations and tests

**A migration changes only objects in its module's namespace.** It cannot
create, alter, rename, or drop another module's objects. Moving ownership needs
an accepted architecture decision and a staged compatibility plan.

Package tests can query and truncate only their module's tables. Application
integration and end-to-end setup can run all migrations. Business assertions
still use public module boundaries.

Migration ordering guarantees that every module can initialize its own storage.
It does not grant a later module access to an earlier module's tables.

## Enforcement

The API architecture and Dependency Cruiser checks enforce package imports.
They do not yet enforce database ownership or names.

A repository database-boundary gate must use the registered package and
database namespace inventory to check:

- Drizzle table and PostgreSQL type declarations.
- Generated migration SQL and Drizzle snapshots.
- Explicit index, constraint, sequence, view, and trigger names.
- Foreign keys and other references to a foreign namespace.
- Raw SQL that names a module-owned object.
- Direct `pgTable` or `pgTableCreator` use outside the owning schema factory.

The gate must run in pull-request verification. A new exception needs a named
owner, reason, tracking issue, and removal condition in this policy. Do not add
a broad path or prefix allowlist.

The pre-deploy remediation baseline contains these known violations:

- Agent has four database object names without the `agent_` prefix.
- The Workspaces root table is named `workspaces`, not
  `workspaces_workspaces`.
- Workflows declares and locks Runners lease tables.
- Auth test setup migrates and truncates Email Challenges storage.
- Module migration-history names can depend on a display name or array
  position instead of the database namespace.

Remove each violation before enabling the gate without a baseline. Because
there is no deployed database state to preserve, correct unshipped migrations
and snapshots directly. Do not add compatibility objects or copy these
patterns.
