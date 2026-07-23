# Architecture decision record 0006: Database ownership boundaries

- **Status:** Accepted.
- **Date:** 2026-07-23.
- **Decision owners:** Server database boundaries.
- **Amends:** [ADR 0002: Server inter-module architecture](0002-api-inter-module-architecture.md).

## Context

**Shipfox modules share one PostgreSQL database and connection setup.** Local
Drizzle table creators usually prefix table names. Most prefixes identify the
module that owns the migrations.

**A naming rule does not enforce ownership.** A consumer can re-declare a
foreign table with Drizzle. It can also name the table in raw Structured Query
Language (SQL). Package import checks do not see either form.

**The current documentation permits two readings.** ADR 0002 says a bounded
context owns its data and transactions never cross contexts. The backend and
module guides also describe modules that use shared database tables. That
language leaves direct cross-module reads open.

**Direct reads couple modules to storage details.** A consumer depends on table
names, columns, migration order, locks, and transaction behavior. The producer
cannot change its storage without coordinating every reader.

## Decision

**Every stored database object has one owning database module.** The module
that declares and migrates an object is its owner. Being in the same bounded
context does not grant access.

**Only the owner queries its objects.** Other modules cannot read, write, join,
lock, reference, or re-declare an owned table. This rule also covers raw SQL,
views, triggers, database functions, and foreign keys.

**Each database migration unit has a stable namespace.** Its tables use the
namespace as a name prefix. Its PostgreSQL types and explicit support object
names use the same namespace. One `ShipfoxModule` owner can compose several
migration units under one stable owner ID. The namespace is a database identity,
not necessarily the module's display name. Migration-history names must use
the registered namespace explicitly when a module's display name is not
compliant.

**Modules cross the boundary through producer-owned contracts.** A caller uses
an inter-module operation for current state, an outbox event for a committed
fact, or Temporal for durable work. Reporting and search use owner-published
projections or snapshots.

**Transactions never cross database owners.** One owner performs an atomic
operation. Work that needs tables from two owners must move to one owner or use
a new consistency protocol.

**The composition root can run all migrations.** This does not grant access to
business data. Module order starts storage. It does not allow shared table
access.

**Static checks will enforce the rule.** The repository will register database
namespaces and audit schema declarations, migrations, foreign references, and
raw SQL. The [database boundary policy](../policies/database-boundaries.md)
defines the current rules and exception process.

## Consequences

**A module can change its storage behind its contract.** Consumers depend on
business operations and published facts instead of table layouts.

**Cross-module joins move behind an owner or into a projection.** Some reads
need a new operation, snapshot, or reporting model.

**Cross-module atomicity requires redesign.** A remote-style call cannot replace
a foreign row lock inside an existing transaction. The operation needs one
owner or an explicit consistency protocol.

**Prefixing becomes a rule.** Existing unprefixed objects must be renamed.
Their migration plan must match the database's compatibility needs.

**The first static gate has cleanup work.** The database boundary policy allows
exact temporary findings. Remove them before the gate becomes a zero-finding
pull-request check.

## Rejected alternatives

### Keep prefixing as a convention

**A convention identifies the owner but cannot stop access.** It permits local
schema copies and raw SQL. Reviews and package import checks can miss both.

### Allow read-only access to foreign tables

**Reads still depend on storage contracts and locks.** A read-only exception
also tends to grow into joins, transaction coupling, and write requirements.

### Allow access within one bounded context

**A context can contain several independently migrated database modules.**
Context membership alone does not identify which module can change a table or
coordinate its migrations.

### Use PostgreSQL roles as the only boundary

**Database roles provide a stronger runtime boundary.** They also add deploy
and connection-pool complexity. Static checks give earlier feedback and work
with the current shared connection model. Roles remain a possible later
defense.
