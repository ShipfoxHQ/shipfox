# ADR 0025: Managed config repositories

- **Status:** Accepted.
- **Date:** 2026-10-31.
- **Decision owners:** Server architecture and integrations.
- **Linear issue:** [ENG-3153](https://linear.app/shipfox/issue/ENG-3153/add-the-managed-repo-provider-on-postgres).
- **Related:** [ADR 0002: Server inter-module architecture](0002-api-inter-module-architecture.md),
  [ADR 0006: Database ownership boundaries](0006-database-ownership-boundaries.md).

## Context

**A workflow has to live in the user's repository.** A user's first workflow therefore needs a
pull request, and every project needs a repository before it can do anything. Shipfox wants a new
project to work right away and stay config-as-code, with history, branches, and review.

**Everything that reads config already goes through `SourceControlProvider`.** Definition sync,
branch dev runs, action snapshots, and prompt files read a repository through that interface.
`projects.source_*` is required, because every project has a config source. A second config path
would mean a second version of each of those flows.

**The stored data is small.** A tree of 130 files is 140 git objects and 13 KB. Action bundles
already live in Postgres as `bytea`.

## Decision

### A managed repo is a provider, with objects and refs in Postgres

**A managed repo is a `SourceControlProvider`, next to GitHub and Gitea.** The provider kind is
`managed`, and a repository id is `managed:<uuid>`. Consumers keep their code paths.

**Git objects and refs live in the `integrations_managed` namespace.** Objects are standard git
objects, deflated, addressed by SHA-1, and immutable. A managed repo is primary data, and Postgres
backups cover objects and refs together, so a restore can't leave a ref pointing at a missing
object. Objects are not packed, because packs save little at this size and add a compaction job.

**Compare-and-set is the only way to move a ref.** Objects and the ref update commit in one
transaction. A failed operation leaves nothing behind. Objects stay stored until the repository is
deleted, even if a later ref move leaves them unreachable. A composite foreign key ties each ref to its commit object, so the database refuses a ref to a
commit the repository doesn't hold.

### isomorphic-git sees objects and nothing else

**`isomorphic-git` builds and reads objects through an `fs` adapter that serves only objects.** A
file API can't express compare-and-set, and plumbing works from object ids, so the library needs
no refs. Any other read reports not found, and any other write throws. That makes a ref write
impossible.

**No ref name reaches the library.** Callers resolve a ref in Postgres and pass an object id. This
removes ref-based path traversal as a class of bug.

**Writes stay in a buffer for one operation.** The buffer reaches the database only in the commit
transaction.

### No wire protocol

**`git clone` and `git push` don't work on a managed repo.** Runners can't read it. Every read and
write goes through the provider or the Integrations contract, so the rules below have one
enforcement point. Moving to a repository is the way out.

### Only a merge moves `main`

**`main` moves twice: at repo creation, and through an approved merge.** Agents commit to branches
only. The default branch check lives in the operation, not in the tool list, so a prompt injection
can't reach `main` through a tool it found. A managed project can't change its live config until
merging ships.

### Moves are one way

**A project's config source is a managed repo or a linked repo, never both.** A move opens a pull
request that adds `.shipfox/`, and the config source moves when the pull request opens. The managed
repo then goes read-only. The merge is an ordinary push to a bound repository, so nothing has to
watch the pull request. There is no way back, and no two-way sync.

## Alternatives considered

| Alternative | Why not |
| --- | --- |
| Store objects in object storage. | It adds settings, a cache, failure modes, and a restore-order risk for 13 KB of text. |
| Route ref paths through the `fs` adapter. | A file API can't express compare-and-set, and hostile ref names would reach the library. |
| Add a config store beside `SourceControlProvider`. | Sync, dev runs, action snapshots, and prompt files would each need a second path. |
| Serve the git wire protocol. | It adds a protocol surface and a second write path that has to enforce the same rules. |
| Move the config source when the pull request merges. | Nothing detects that merge today. It needs a new event, a reconcile loop, and a freeze that can last days. |

## Consequences

- `isomorphic-git` is one dependency behind one package. Stored objects are standard git, so
  leaving the library needs no data migration.
- Each object read is a primary key lookup. A file read takes about 5 lookups, and a sync of 100
  workflows about 500. That is acceptable for a sync, so there is no cache across operations.
- Managed projects can't run a job with a default checkout. A job must set `checkout: false` or
  name a repository and a connection.
- A secret committed by mistake stays stored until the project is deleted, because history can't
  be rewritten.
- A closed move pull request leaves the project on the linked repo, running its last good
  definitions.
