# Shipfox API Triggers

Shipfox API Triggers decides when a workflow run starts. It projects the
`triggers` map from each workflow YAML into an indexed subscription table,
matches incoming integration events against those subscriptions, and starts
a workflow run for every match. It also exposes the HTTP route that fires
manual runs.

## Example

Register the module with the API module runner:

```ts
import {triggersModule} from '@shipfox/api-triggers';
import {createApp, listen} from '@shipfox/node-fastify';
import {initializeModules} from '@shipfox/node-module';

const {auth, routes} = await initializeModules({
  modules: [triggersModule /* and other modules */],
});

await createApp({auth, routes});
await listen();
```

This adds:

- triggers database migrations from `libs/api/triggers/drizzle`
- the `POST /workflow-definitions/:definitionId/fire-manual` route
- subscribers for `DEFINITION_RESOLVED`, `DEFINITION_DELETED`, and
  `INTEGRATION_EVENT_RECEIVED`
- the `triggers` outbox publisher

A workflow YAML opts into triggers like this:

```yaml
triggers:
  on_demand:
    source: manual
  on_push:
    source: github
    event: push
    on: main
```

Each map key is the trigger's `name`. A workflow may declare any number of
integration triggers and at most one `source: manual` trigger; the manual
invariant is enforced at parse time so the fire route stays unambiguous.
The `event` field is optional when `source: manual` and defaults to
`fire`.

## Setup

This package is private to the workspace. Add it to another workspace
package with:

```json
{
  "dependencies": {
    "@shipfox/api-triggers": "workspace:*"
  }
}
```

The matching HTTP contract lives in
[`@shipfox/api-triggers-dto`](../triggers-dto). Import Zod schemas and DTO
types from there when you call the route from the client.

The package does not read any environment variables of its own. It depends
on the API database connection from `@shipfox/node-postgres`.

## Routes

The route is mounted by the host app under the `/workflow-definitions`
prefix.

| Method | Path | Auth | Result |
| --- | --- | --- | --- |
| `POST` | `/:definitionId/fire-manual` | bearer token | Fires the workflow's manual trigger and returns the new `run_id`. Optional `inputs` in the body are forwarded to the run. |

The route is keyed by workflow definition id, not subscription id. The
server resolves the manual subscription for the workflow internally; the
"at most one manual trigger per workflow" invariant from the parser keeps
that lookup unambiguous. Integration sources (github, etc.) fire through
the event bus and have no HTTP entry point.

## Vocabulary

Three words, used the same way at every layer.

| Word | Meaning | Examples |
| --- | --- | --- |
| **source** | Where the trigger came from. | `github`, `gitlab`, `sentry`, `manual`, `cron` |
| **event** | The specific thing that happened, scoped to a source. | `push`, `issue_comment`, `alert_triggered`, `fire`, `tick` |
| **payload** | The data carried by the event. Shape is set by `(source, event)`. | `{ref, headCommitSha, ...}` for `(github, push)` |

The `name` field on a subscription is the YAML map key (for example
`on_push`). It identifies the trigger inside a workflow definition and is
unique per `(workflow_definition_id, name)`.

### Words we do not use

- `provider` — reserved for the integration module's identity
  (`integrations_connections.provider`). Trigger code says `source`.
- `eventType` / `type` — replaced by `event`. The bare word `type` would
  collide with TypeScript discriminators and with the `IntegrationProvider`
  capability `type` field.
- `triggerContext` — the runtime payload on a run is called
  `triggerPayload`.
- `kind` — every trigger is identified by `(source, event)`. There is no
  separate axis.

## Architecture

Triggers flow through three layers. The YAML map is the source of truth,
the subscription table is the queryable projection, and the workflow run
table is the immutable history.

```
                ┌─────────────────────────────────────────────────────┐
                │  workflow_definitions.definition (JSONB)            │
                │  triggers: {on_push: {source, event, ...}}          │
                └──────────────────────────┬──────────────────────────┘
                                           │
                                           │  DEFINITION_RESOLVED
                                           │  / DEFINITION_DELETED
                                           ▼
                ┌─────────────────────────────────────────────────────┐
                │  triggers_subscriptions                             │
                │  (workspace_id, project_id,                         │
                │   workflow_definition_id, name,                     │
                │   source, event, config)                            │
                └──────────────────────────┬──────────────────────────┘
                                           │
INTEGRATION_EVENT_RECEIVED → match on (workspace, project, source, event)
or POST /workflow-definitions/:definitionId/fire-manual → look up manual subscription
                                           │
                                           ▼
                ┌─────────────────────────────────────────────────────┐
                │  workflow_runs                                      │
                │  trigger_source, trigger_event (indexed text)       │
                │  trigger_payload (jsonb, discriminated on the pair) │
                └─────────────────────────────────────────────────────┘
```

### Layer 1 — workflow definition (source of truth)

The YAML `triggers` map lives inside `workflow_definitions.definition`
(JSONB owned by the definitions module). That is the only place trigger
declarations live in raw form.

### Layer 2 — projection (queryable)

`triggers_subscriptions` is rebuilt from `DEFINITION_RESOLVED` events,
which carry the parsed `triggers` map. The triggers module never reads the
definitions table — the event is the contract.

Indexes:

- `(workflow_definition_id, name)` — unique. One row per YAML trigger.
- `(workspace_id, project_id, source, event)` — the hot path for matching
  incoming integration events.
- `(workflow_definition_id)` — used to clean up the projection on
  `DEFINITION_DELETED`.

### Layer 3 — run history (immutable)

`workflow_runs.trigger_source` and `trigger_event` are indexed text
columns. `trigger_payload` is a JSONB column whose shape is set at compile
time by the discriminated union `TriggerPayload`. The `triggerSource` value
on a row always equals `triggerPayload.source`. The duplication is
deliberate: the indexed column is for filtering, the payload is for
inspection.

## Events

| Event | Published by | Consumed by | Purpose |
| --- | --- | --- | --- |
| `INTEGRATION_EVENT_RECEIVED` | `integration/*` | triggers, projects | An integration received a webhook and validated it. The payload is the integration's domain event. |
| `DEFINITION_RESOLVED` | definitions | triggers | A workflow definition was created or updated. The payload includes the parsed `triggers` map. |
| `DEFINITION_DELETED` | definitions | triggers | A workflow definition was soft-deleted. Subscription rows are removed. |

## API

The package exports the module entry point:

```ts
import {triggersModule} from '@shipfox/api-triggers';
```

It also exports lower-level pieces for tests and advanced wiring:

- `fireManualSubscription()`: core function used by the route. Throws
  `TriggerSubscriptionNotFoundError`,
  `TriggerSubscriptionNotManualError`, or
  `TriggerWorkspaceMismatchError`.
- `ManualTriggerNotFoundError`: thrown by the route handler when the
  caller's workspace cannot reach the workflow, or the workflow declares
  no manual trigger. Surfaced as `404 manual-trigger-not-found`.
- `findMatchingSubscriptions()`: hot-path lookup by
  `(workspace_id, project_id, source, event)`.
- `getManualSubscriptionByDefinitionId()`: resolves the single manual
  subscription for a workflow definition (or `undefined` if none).
- `getTriggerSubscriptionById()` and
  `listSubscriptionsByWorkflowDefinitionIds()`: read helpers.
- `db`, `migrationsPath`, and `triggersOutbox`: the Drizzle handle,
  migration path, and outbox table.
- Entity type: `TriggerSubscription`.

## Adding a new source

To wire a new integration source (for example GitLab):

1. Add a payload type for each supported event to
   `@shipfox/api-integration-core-dto` (for example `GitlabPushPayload`).
2. In the new `integration/<source>` package, receive webhooks and publish
   `INTEGRATION_EVENT_RECEIVED` with `source: '<name>'`,
   `event: '<type>'`, and the payload.
3. Extend `TriggerPayload` in `@shipfox/api-workflows` with the new
   `(source, event)` arms so the run table keeps its typing.
4. Update the triggers module's `on-integration-event-received` subscriber
   so it can resolve the project for the new source (for example
   `getProjectBySource` for repository-backed sources) and evaluate the
   YAML `on` field for that event.

No changes are needed to the projection schema, the manual fire route, or
the run table. The columns are open-ended strings.

## Development

Run checks for this package:

```sh
turbo check --filter=@shipfox/api-triggers
turbo type --filter=@shipfox/api-triggers
turbo test --filter=@shipfox/api-triggers
```

Tests use Vitest and a real PostgreSQL database. Start local services
before running the test suite:

```sh
docker compose up -d
```

The test environment uses the `api_test` database, set in `test/env.ts`.

## License

MIT
