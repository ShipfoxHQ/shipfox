# Architecture decision record 0016: Workflow run concurrency

- **Status:** Proposed.
- **Date:** 2026-09-07.
- **Decision owners:** Workflows, Definitions, Triggers, Integrations, Runners, and workflow
  product surfaces.
- **Linear issue:** [ENG-2012](https://linear.app/shipfox/issue/ENG-2012/record-workflow-concurrency-architecture-decision).
- **Related:** [ADR 0006: Database ownership boundaries](0006-database-ownership-boundaries.md),
  [ADR 0015: Usage context and application seams](0015-usage-context-and-application-seams.md),
  and [job-admission paths](../architecture/job-admission-paths.md).

## Context

One provider event can make earlier work obsolete. Pull request updates are the main example. A
project may receive several updates while a review, build, or deployment is still running.

Today, every accepted trigger creates an independent run attempt. Attempts can execute at the same
time and publish stale results. Workflow authors need a bounded latest-wins queue like
[GitHub Actions concurrency](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#concurrency).

Shipfox has additional constraints:

- A workflow can be started by an integration event, cron, a manual action, or a dev replay.
  Context roots such as `event` and `inputs` can be `null`, depending on the trigger.
- Integration outbox rows currently have no ordering key. Competing dispatcher consumers can
  process two persisted events from one integration connection in the opposite order.
- Reruns create a new attempt from stored run state and do not rebuild all context.
- Dev runs are explicit user intents and do not have trigger idempotency keys.
- Listening jobs consume later events inside one long-lived run. They can remain active for the
  workflow timeout, which defaults to 30 days.
- A `pending` run is displayed as running on existing product surfaces.
- Workflows records cancellation before Runners cooperatively stop local work.

The concurrency decision must preserve trigger idempotency, survive process restarts and Temporal
replay, and explain its state through the normal run model.

## Decision

### Authoring contract

`concurrency` is an optional top-level workflow field:

```yaml
name: Review pull request

concurrency:
  group: pull-request-${{ event.pull_request.number }}
  cancel_in_progress: true

triggers:
  opened:
    source: github_acme
    event: pull_request.opened
  reopened:
    source: github_acme
    event: pull_request.reopened
  synchronized:
    source: github_acme
    event: pull_request.synchronize

jobs:
  review:
    steps:
      - prompt: Review this pull request.
```

`group` is a required string interpolation template. `cancel_in_progress` is an optional literal
boolean and defaults to `false`.

A group is scoped to its workflow definition by default. Cross-workflow coordination is explicit:

```yaml
concurrency:
  scope: project
  group: production-deployment
  cancel_in_progress: false
```

`scope` accepts `workflow` or `project` and defaults to `workflow`. Two definitions coordinate only
when both use `scope: project` and resolve the same canonical group key. Project scope never crosses
the project boundary.

Definitions that contain a listening job cannot declare `concurrency` in the first version. The
definition is rejected before it can run. This avoids a long-lived listener holding a group and a
later event causing a workflow to cancel its own listener loop.

### Group resolution

Definitions parses the group at the run-creation availability site. The template can use
`workflow`, `trigger`, `event`, `inputs`, and `vars`. It cannot use `run`, `job`, `execution`,
`jobs`, `needs`, `steps`, `step`, or `secrets`.

`event` is `null` for manual and cron starts. `inputs` is `null` for any start without configured
or supplied inputs. This includes cron and integration triggers that do not define inputs.

A workflow-scoped group for one trigger source normally needs no source or event prefix. The pull
request actions in the primary example must resolve the same group. Including `trigger.event` would
split `pull_request.opened` and `pull_request.synchronize` into different groups.

A definition that uses several trigger sources can add `trigger.source` to avoid collisions between
payload shapes:

```yaml
concurrency:
  group: ${{ trigger.source }}-pull-request-${{ event.pull_request.number }}
```

An event and a manual trigger can share one group through a null comparison and a conditional
expression:

```yaml
concurrency:
  group: pull-request-${{ event != null ? event.pull_request.number : inputs.pull_request_number }}
```

The evaluator resolves only the selected conditional branch. The form above works for an event
payload and for a manual run with `inputs.pull_request_number`. It still fails for a trigger where
both roots are `null`, such as a cron trigger without configured inputs.

The Definitions module compares every referenced context root with each declared trigger's
availability. It emits a definition-time warning when a referenced root can be `null`. The first
version does not inspect the CEL abstract syntax tree to recognize guarded branches. The conditional
example above evaluates correctly at runtime, but it still receives the conservative warning.
Authors silence the warning by using inputs available to every trigger or by splitting triggers
into separate definitions.

The runtime never converts a missing `event` or another unresolved value to an empty string. A
resolution failure is a permanent configuration failure for that trigger-processing attempt. The
transaction commits no run, attempt, claim, or attempt-created event.

The Workflows variable-reference collector must include `concurrency.group`. This ensures every
referenced `vars` value is loaded into the same stable snapshot used to resolve the group.

### Group identity

The effective identity depends on the selected scope:

```text
workflow scope:
  (project_id, origin_scope, "workflow", definition_id, canonical_group_key)

project scope:
  (project_id, origin_scope, "project", canonical_group_key)
```

The scope discriminator prevents a project-scoped group from colliding with a workflow-scoped
group that happens to use the same text.

`origin_scope` isolates normal and dev work:

| Run origin | Origin scope |
| -- | -- |
| Synced | `synced` |
| Dev | `dev:<initiated_by_user_id>` |

Dev runs from different users cannot wait for or cancel one another. A rerun of a dev run retains
the original run's stored `initiated_by_user_id`, even when another user requests the rerun. Synced
and dev runs never coordinate.

The resolved group key follows these rules:

- Trim leading and trailing whitespace to produce the display key.
- Require the display key to contain between 1 and 256 UTF-8 bytes.
- Apply one deterministic, locale-independent Unicode case fold to produce the canonical key.
- Do not apply Unicode normalization. Canonically equivalent but differently encoded display keys
  remain different groups.
- Apply no second byte limit after case folding. The bounded display input limits the stored
  canonical value.

The display key is returned to users. The canonical key owns equality and database uniqueness. A
digest can derive the advisory-lock key, but a digest collision cannot merge database identities.
Group keys are never metric labels.

### Queue and latest-wins behavior

Each effective group has at most one acquired attempt and one waiting attempt:

| Existing state | Result for the incoming attempt |
| -- | -- |
| No acquired attempt | Acquire the group. |
| Acquired attempt only | Become the waiting attempt. |
| Acquired and waiting attempts | Supersede the waiter and become the only waiting attempt. |

The incoming attempt's `cancel_in_progress` value governs admission. When it is `true`, admitting
the waiter also records a durable request to cancel the current holder. This applies even when the
holder came from a workflow whose own value was `false`. An incoming value of `false` never cancels
the holder and cannot revoke an earlier cancellation request.

Latest means the greatest generation committed by Shipfox while holding the effective group lock.
The generation is allocated only after trigger idempotency succeeds. It does not use provider
timestamps, delivery identifiers, HTTP receipt time, run numbers, or Temporal start time.

Integration-triggered concurrency has one prerequisite: every integration provider derives an
ordering scope before publishing `INTEGRATION_EVENT_RECEIVED`:

- When the event identifies one repository, the ordering key combines `connectionId` with the
  provider-owned repository ID.
- When the provider cannot derive a repository, the ordering key falls back to `connectionId`.

The three SPI publish ports carry the optional ordering scope: `PublishIntegrationEventReceivedFn`,
`PublishSourcePushFn`, and `PublishSourceRepositoryUpdatedFn`. The provider adapter owns repository
extraction. GitHub and Gitea supply provider-owned repository IDs. Integration Core stays
provider-neutral and writes the supplied key or the fallback based on the integration connection.
The repository-scoped key preserves persisted event order for one repository. It removes reversal
by competing dispatcher consumers without serializing every repository in a GitHub App installation.

A non-empty outbox ordering key blocks later rows with the same key until the first row dispatches
or dead-letters. A transient failure therefore delays later events for that repository. The current
outbox defaults allow five claims and cap each requested retry delay at 30 minutes. Events that use
the fallback for an integration connection have the wider delay and throughput boundary.

Ordering does not repair events that the provider delivered out of order. It also does not reorder
concurrent webhook transactions that persisted in another order. In those cases, the last event
processed by Shipfox still wins.

A duplicate trigger delivery returns its existing run. It does not allocate a generation, replace a
waiter, or request cancellation again.

### Run state and reruns

`waiting` becomes a workflow run and run-attempt status. A run uses `waiting` only while its current
attempt owns the waiting claim. Promotion changes only the durable claim and publishes a signal.
The orchestration then re-reads the acquired claim and the current attempt version. It moves the run
and attempt directly from `waiting` to `running` with that fresh version. It does not pass through
`pending`.

The one-active-attempt partial index must treat `waiting`, `pending`, and `running` as active.
Existing list, detail, filter, aggregate, metric, and client status handling must recognize
`waiting`; it is not presented as running.

Concurrency wait time does not consume the workflow run timeout. The timeout begins after the
attempt acquires the group and starts normal orchestration. There is no separate concurrency wait
timeout in the first version. A waiter can remain blocked for the holder's remaining run timeout,
which is 30 days by default.

A rerun acts as a new group participant. It copies the source attempt's resolved display key,
canonical key, scope, `cancel_in_progress`, and origin scope. It receives a new generation and does
not re-evaluate the template or fetch current provider data or variables.

This means rerunning an older, superseded attempt can supersede a newer waiter or cancel the current
holder. The rerun API requires explicit concurrency-impact confirmation whenever arbitration would
supersede a waiter or request holder cancellation. Without confirmation, it returns a conflict with
the affected attempt identities and planned effects. The UI explains the impact and resubmits only
after confirmation. The server checks this inside arbitration so a stale client read cannot bypass
the confirmation.

### Durable arbitration

Workflows owns a durable concurrency claim for each participating run attempt. A claim stores the
effective identity, display and canonical keys, definition, run, attempt, generation, policy,
state, replacement link, and state timestamps. Claim states are `acquired`, `waiting`,
`superseded`, and `released`.

Partial unique indexes enforce one acquired claim and one waiting claim per effective identity. A
separate unique index enforces one claim per run attempt. Historical claims remain linked to their
attempts so the API can explain waiting and supersession.

Every mutation for one effective group takes the same transaction-scoped PostgreSQL advisory lock.
Within that lock, Workflows reads the current slots, allocates the generation, replaces any waiter,
inserts or updates the claim, and writes its outbox events. Database constraints remain the final
invariant. No transaction calls another module while holding the group lock.

Temporal signals are notifications, not authority. Run orchestration reads the durable claim before
starting and after every acquire, cancellation, or supersession signal. A waiting or superseded
attempt cannot start because only an acquired claim authorizes execution.

Terminal attempt events release claims. When the holder becomes terminal, a group-locked consumer
promotes the current waiter and writes a durable promotion event. Event consumers and a periodic
reconciler apply the same idempotent transitions after retries, duplicate delivery, or process
failure.

### Lock order and cancellation

Workflows uses this lock order:

1. Initial creation takes the trigger-idempotency advisory lock when present, allocates the
   definition counter, inserts the run and attempt, and then takes the group advisory lock.
2. Rerun creation takes the run advisory lock, run row, source-attempt row, and then the group
   advisory lock.
3. Group event consumers take only the group advisory lock. They commit group state and outbox
   events before any cancellation or run-status transaction begins.
4. Cancellation and the orchestration's `waiting` to `running` transition use run-side locks without
   holding the group lock. The orchestration re-reads the attempt version after acquisition.
5. A path that holds the group lock never attempts to acquire a run-side lock.

This order prevents a group consumer and a creation or termination transaction from forming a
group-to-run lock cycle.

Concurrency supersession uses a dedicated idempotent Workflows terminal operation. It does not call
the user cancellation entry point, which rejects already-terminal runs. The new
`concurrency_superseded` reason must pass through Workflows status types and outbox DTOs, Runners
DTO validation and subscriber mapping, and runner reconciliation. An unknown reason must not be
converted to `null`, because that would remove server state without requesting runner shutdown.

Cancellation is a control-plane transition with cooperative runner shutdown. A replacement can
start after Workflows records the holder as terminal. It does not wait for runner acknowledgment,
so old and new processes can overlap briefly. Workflow authors must fence or make externally
visible effects idempotent when overlap is unsafe.

### User-visible contract

Run reads expose the display group, scope, state, policy, generation, and linked replacement or
holder identities. Product surfaces show `Waiting for concurrency group <group>` for waiting runs
and `Superseded by <workflow> run #<number>, attempt <attempt>` for cancelled runs. Project-scoped
groups are identified as shared across workflows.

Definitions must not accept the field until every affected contract supports it. This includes the
authoring schema, normalized snapshot, and generated schema and reference. It also includes API
DTOs, database statuses, filters, aggregates, metrics, provider ordering scopes, and Runners stop
reasons. A partially deployed system must not parse concurrency and then execute a run without
arbitration.

## Consequences

- Workflow-local coordination is the safe default. Authors opt in when several definitions should
  share a group.
- Every effective group keeps bounded live state: one holder and one waiter.
- A rerun can intentionally affect newer work, but supersession or cancellation requires explicit
  confirmation.
- Dev concurrency is isolated by initiating user as well as from synced work.
- Listening workflows cannot use concurrency in the first version.
- Persisted events are ordered per repository when the provider can identify one. Other events use
  their integration connection as the wider ordering boundary.
- Ordering can delay all later events in that boundary while an earlier event retries. It also
  serializes dispatch within the boundary.
- Concurrency has no queue timeout. A waiter can remain blocked for the holder's remaining timeout,
  which is 30 days by default.
- The run status model gains `waiting` before the platform contract is deployed broadly.
- Workflows gains durable claim state, outbox events, reconciliation, and cross-surface DTO state.
- Cooperative cancellation permits short physical overlap and cannot undo earlier external effects.

## Rejected alternatives

### Share groups across workflows by default

Copied group names could make unrelated workflows cancel one another. Explicit `scope: project`
keeps the capability without making it the default.

### Support listening jobs in the first version

A listening run can hold a group for weeks and can consume the same event that starts its
replacement. Supporting that interaction needs a separate definition of whether the listener loop,
each materialized execution, or another lifecycle owns the slot.

### Order by provider timestamps or an author expression

Providers differ in ordering fields and semantics. An `order_by` expression adds provider-specific
comparison and missing-value behavior. Shipfox instead preserves per-repository order when possible
and defines precedence at arbitration.

### Order every event by integration connection

A GitHub App integration connection can cover an organization with many repositories. One key for
the whole integration connection would make a failed event stall later events for that organization.
It would also make a busy organization single-threaded. Repository keys reduce the blast radius.
The fallback for an integration connection still covers events without repository identity.

### Store only a mutex in Temporal

A Temporal-only mutex cannot atomically replace a waiter with run creation. It also makes APIs,
reruns, idempotency, and recovery harder to explain from Workflows state.

### Keep every waiting attempt

A full queue executes stale work and grows without a useful bound. The target use case needs the
latest waiter, not every intermediate event.

### Start the replacement before the holder is terminal

Waiting for the Workflows terminal transition preserves one acquired claim and deterministic
recovery. Waiting for physical runner acknowledgment is also rejected because the existing runner
contract reports a cancellation request, not proof that local work stopped.

### Implement concurrency as workflow admission policy

Admission policy decides whether work may be created. It does not own durable order, waiting,
cancellation, promotion, or run status.
