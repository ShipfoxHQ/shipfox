# Architecture decision record 0019: Collection navigation

- **Status:** Proposed.
- **Date:** 2026-09-20.
- **Decision owners:** Client composition maintainers, server architecture, and design system.
- **Linear issue:** [ENG-2214](https://linear.app/shipfox/issue/ENG-2214/record-the-collection-navigation-architecture-decision).
- **Amends:** [ADR 0003: Client state and domain architecture](0003-client-state-and-domain-architecture.md).
- **Related:** [ADR 0012: Client route frames](0012-client-route-frames.md) and the
  [Data table system specification](https://linear.app/shipfox/document/data-table-system-specification-7b7d496c478d).

## Context

**A table that pages cannot sort itself.** The workflows definitions table offers a sortable
Updated column and a search box. The server orders definitions by `asc(name), asc(id)` and
returns 50 rows. Past 50 definitions the sort reorders only the alphabetically first page. The
search reports no matches while a match sits on the next page. The control lies to the reader.

**Every collection surface picks its own navigation.** The client has twelve hand-rolled
load-more controls. Two of them sit in one file. One button appears twice inside a single states
module. Each one re-implements its own loading, error, and retry behavior.

**The server cannot sort on demand.** No list endpoint accepts `sort`, `order`, or `order_by`.
All 29 endpoints fix their ordering in the query. The settings tables also lack the composite
indexes that server-side sorting would need.

**One collection is already provably complete.** Secrets enforces a write-side cap. A write above
`SECRETS_MAX_PER_WORKSPACE` throws in `libs/api/secrets/src/core/store-validation.ts`.
Configuration rejects a cap larger than the list limit. The settings client then requests the
whole bounded set. Completeness is an enforced invariant, not an assumption about size.

**Two collections have no ordering at all.** `listMembershipsByWorkspace` and
`listOpenInvitationsByWorkspace` run without an `ORDER BY`. Their row order is not stable between
requests.

## Decision

This record makes three commitments. It deliberately does not choose a pagination style for
every collection, and it does not restructure producer response shapes.

It covers navigation, sorting, filtering and their presentation. Data freshness is separate
logic. Polling, refresh triggers, cache invalidation and staleness belong to the feature and to
ADR 0003. This record says nothing about them.

### Sorting and filtering state the truth

A control that sorts or filters must act on the rows it claims to act on.

A result set is **complete** when it contains every row in its declared query scope. Scope means
the filters the request carried, such as one workspace or one project. Completeness is a property
of the response, not of the collection's size.

Over a complete result set, a feature sorts and filters locally. The result is correct because no
row is missing.

Over any other result set, sorting and filtering run server-side, or the surface does not offer
them. A partial response stays partial. Truncating a response and showing a notice does not make
a local sort correct, because the rows outside the response still belong to the collection.

An endpoint that returns every row in scope is complete today. Nothing guarantees it stays
affordable as the collection grows. A write-side cap is the preferred way to keep complete
fetching bounded, and adding one is an accepted cost. A cap is not the definition of
completeness, and no cap should exist only to enable a local sort.

A collection that adopts a cap accepts four obligations:

- the cap binds on every production write path, not on one of them;
- admission is atomic under concurrent writes, so two writes cannot both observe room for the
  last slot;
- the record states what happens to a collection already above the cap when the cap lands;
- refusing a write never deletes a row that already exists.

Secrets is the working precedent. `lockWorkspaceEntries` takes a transaction-scoped advisory lock
in `libs/api/secrets/src/db/cap.ts`, `assertWorkspaceCap` then counts and rejects, and every
store path calls both inside one transaction.

A refused write reports itself where the writer is looking. A member invitation above the cap
fails that invitation with a known error.

Server-side search is not a substitute for reaching the whole collection. Search serves a reader
who knows what to name. It does not serve reviewing every member, or finding the most recently
updated workflow. A picker may be search-first. A management table may not, unless its tasks are
shown to be search-shaped.

### One shared footer, appending by default

Append is the default navigation for a collection that is not complete. It fits the product
today, and every existing surface already works this way.

The shared footer carries capability and intent, not presentation:

- whether more rows exist;
- whether a fetch is in flight;
- how to request the next set;
- how to retry a failed fetch;
- how many rows are loaded;
- optionally, a producer-supplied total for the active filters.

A total is independent of appending. A producer that counts its filtered rows may report them,
and the footer may read "50 loaded of 143". Workflow runs already returns `filtered_total_count`,
and the client already maps it. A footer without a producer total announces rows loaded. It does
not announce a total, because a total implies completeness the response does not have.

Replacing the button with scroll-triggered loading is a presentation change behind this contract.
It is not a contract change.

The footer defines focus for three transitions, and it never takes focus the reader has moved
elsewhere. A successful append announces the rows loaded. A failed append moves focus to the
retry control only if the load-more control still holds focus. Exhaustion removes the control, so
focus moves to the footer region under the same condition. In every other case the reader keeps
the focus they chose and hears the outcome announced. A request can finish long after the click,
and the same rule governs the scroll-triggered variant.

The surface owns scrolling. A page frame and a constrained panel are both valid hosts. Neither is
intrinsic to appending.

### Navigation state belongs to the feature

The shared footer renders controls. It holds no cursor, no page index, and no fetch.

A feature that wants backward navigation uses the pages it already holds, or request cursors it
retained, against the existing forward endpoint. Backward movement through visited pages does not
require a reverse endpoint. Reverse pagination answers a different need, which is entering the
collection at an arbitrary point and moving backward from there. No surface needs that today.

A deep link may carry a starting cursor. Whether that link stays meaningful over time is the
producer's contract, not this record's.


### One footer component

`@shipfox/react-ui/data-table` exposes one footer. It takes a discriminated union on the kind of
navigation the surface offers.

The union admits `complete`, `append`, and `paged`. Each arm carries only the inputs its kind can
accept. An appending footer cannot receive a page count. A complete footer cannot receive a
load-more callback.

This claims less than it may appear to. The union prevents a mismatched set of props. It cannot
prove that an array is complete or that a sort callback reaches the server. Those remain feature
obligations, verified where the Enforcement section places them.

`DataTablePagination` becomes the `paged` arm rather than a separate export. Its behavior, tests,
and stories carry over, so nothing is rebuilt later for the administrator directories. The
resulting major version is acceptable because no surface in either repository imports the
component today.

## Deferred

These are real, and they are not decided here. Deciding them now would couple them to a contract
that does not need them.

- **Offset pagination with totals and page numbers.** No surface needs it. The administrator
  directories are the likely first consumer, and their index cost belongs with them.
- **Producer response envelope consolidation.** Feature adapters already translate producer DTOs
  into client shapes, so the client rule is enforceable without one wire format. Reusing the
  limit schema construction is worthwhile on its own terms, and endpoint-specific limits stay.
- **Constant-height cursor windows.** No surface needs one.
- **The `paged` arm's consumers.** The arm exists in the union because its implementation already
  exists and is tested. No surface selects it yet.
- **Definition admission.** Whether definitions gain a cap, how existing definitions keep their
  slots, how new ones are selected, and how refusal interacts with sync deletion all belong to
  the Definitions context. This record states the obligations a cap carries. It does not design
  workflow admission.

## Enforcement

Two layers, with honest limits.

`@shipfox/react-ui` tests the shared footer in isolation. It covers the loading, error, retry,
exhaustion, focus, and announcement transitions. A renderer assertion can check that a surface
declared a capability. It cannot prove that a sort callback reaches the server, and it cannot
prove that an array it receives is complete.

The feature boundary tests the claims the renderer cannot. An adapter test proves that changing a
sort issues a server request, or that a complete surface requests the whole bounded set. This is
where completeness, server sorting, and server filtering are actually verified.

## Consequences

- Secrets and variables satisfy the completeness rule today. Their local sorting is already
  correct, and they need no change beyond adopting the shared table.
- Members and invitations already return every row in scope, so they are complete today. They gain
  a deterministic `ORDER BY`, which their queries currently lack, and their local sorting and
  search become correct. A write-side cap follows to keep complete fetching bounded, and it
  carries the four cap obligations rather than a bare limit.
- Workflow definitions is not complete. Its endpoint pages at a maximum limit of 100, so its
  Updated sort and its search are untruthful now. Making it complete needs a cap whose admission
  rules the Definitions context owns, because sync soft-deletes definitions absent from its input.
  Until those rules exist, the two controls come off or move server-side.
- Trigger events keeps appending. Its filter bar moves into the table toolbar and its load-more
  control moves into the shared footer. Its headers offer no sorting.
- Workflow runs keeps appending and keeps its reading-mode pause, now as specified behavior. Its
  client-side branch, actor, and search filters either move server-side or stop being offered.
- `@shipfox/react-ui` takes a major version. `DataTablePagination` is folded into the footer
  union in the same release.
- A new list surface declares whether its result set is complete. That declaration decides whether
  it may sort locally.

## Rejected alternatives

### Treating a capped response as complete

A response capped at 500 rows over a collection of 501 is not complete. A local sort over it
reorders 500 of 501 rows and presents the result as the whole collection. This reproduces the
defect the record exists to remove, at a larger row count.

### Search as the overflow path for management tables

This assumes the reader can name what they want, and can narrow below the cap. Reviewing every
member and finding the most recently updated workflow are browsing tasks. A broad search can
itself exceed the cap.

### Requiring reverse endpoints for backward navigation

Backward movement through already-visited pages needs the pages or their request cursors. The
client can retain both. Reverse endpoints answer entry at an arbitrary point, which is a
different requirement that no surface has.

### Consolidating the producer envelope inside this record

The client rule is enforceable at the feature adapter, which already maps producer DTOs. Coupling
the rule to a repository-wide wire change would delay a contract that does not depend on it.

### Trimming the sync input at a definitions cap

This looked like a way to cap definitions without failing a git push. It is unsafe.
`applyVcsDefinitionsBatch` derives `keepConfigPaths` from its own input and soft-deletes every
definition absent from it. Trimming the input at a cap would delete working workflows rather than
decline new ones. Any definitions cap has to admit or refuse without touching the deletion set.

### Keeping `DataTablePagination` beside a separate append footer

Its optional page label, result count, and page-size controls are not incompatible with
cursor-backed data. Compatibility is not the reason to move it. Two exported footers would leave
no single place declaring which prop combinations are legal. That is the mismatch this record
set out to remove. A major version with no importer to migrate is the cheaper side.
