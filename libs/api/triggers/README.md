# @shipfox/api-triggers

The triggers module decides when a workflow run starts.

A workflow YAML declares zero or more triggers. The triggers module projects
those declarations into an indexed `triggers_subscriptions` table, listens for
integration events, matches them against subscriptions, and calls
`runWorkflow` for each match. It also owns the HTTP endpoint that fires
manual runs.

## Vocabulary

Three words, used the same way at every layer.

| Word | Meaning | Examples |
| --- | --- | --- |
| **source** | Where the trigger came from. | `github`, `gitlab`, `sentry`, `manual`, `cron` |
| **event** | The specific thing that happened, scoped to a source. | `push`, `issue_comment`, `alert_triggered`, `fire`, `tick` |
| **payload** | The data carried by the event. Shape is determined by `(source, event)`. | `{ ref, headCommitSha, ... }` for `(github, push)` |

The `name` field on a subscription is the YAML map key (e.g. `on_push`). It
identifies the trigger within a workflow definition and is unique per
`(workflow_definition_id, name)`.

### Words we do not use

- `provider` — reserved for the integration module's identity
  (`integrations_connections.provider`). Trigger code says `source`.
- `eventType` / `type` — replaced by `event`. The bare word `type` would
  collide with TypeScript discriminators and with the `IntegrationProvider`
  capability `type` field.
- `triggerContext` — the runtime payload on a run is called `triggerPayload`.
- `kind` — every trigger is identified by `(source, event)`; no separate
  axis.

## YAML shape

```yaml
triggers:
  on_demand:
    source: manual
    event: fire
  on_push:
    source: github
    event: push
    on: main
    filter: event.ref == "refs/heads/main"  # currently accepted but ignored
```

Each map key is the trigger's `name`. A workflow can have any number of
triggers; firing any one of them creates a workflow run.

## The three layers

```
                ┌─────────────────────────────────────────────────────┐
                │  workflow_definitions.definition (JSONB)            │
                │  triggers: { on_push: {source, event, ...} }        │
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
or POST /trigger-subscriptions/:id/fire → look up subscription
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
(JSONB owned by the definitions module). It is the only place trigger
declarations are stored in their raw form.

### Layer 2 — projection (queryable)

`triggers_subscriptions` is rebuilt from `DEFINITION_RESOLVED` events,
which carry the parsed `triggers` map. The triggers module never reads
the definitions table — the event is the contract.

Indexes:

- `(workflow_definition_id, name)` — unique; one row per YAML trigger.
- `(workspace_id, project_id, source, event)` — the hot path for matching
  incoming integration events.
- `(workflow_definition_id)` — for projection cleanup on
  `DEFINITION_DELETED`.

### Layer 3 — run history (immutable)

`workflow_runs.trigger_source` and `trigger_event` are indexed text
columns; `trigger_payload` is a JSONB whose shape is determined at
compile time by the discriminated union `TriggerPayload`. `triggerSource`
on a row always equals `triggerPayload.source`; the duplication is
deliberate — the indexed column is for filtering, the payload is for
inspection.

## Events

| Event | Published by | Consumed by | Purpose |
| --- | --- | --- | --- |
| `INTEGRATION_EVENT_RECEIVED` | `integration/*` | triggers, projects | An integration received a webhook and validated it. Payload is the integration's domain event. |
| `DEFINITION_RESOLVED` | definitions | triggers | A workflow definition was created or updated. Payload includes the parsed `triggers` map. |
| `DEFINITION_DELETED` | definitions | triggers | A workflow definition was soft-deleted. Subscription rows are removed. |

## Adding a new source

To wire a new integration source (e.g. GitLab):

1. Add a payload type for each supported event to `@shipfox/api-integration-core-dto`
   (e.g. `GitlabPushPayload`).
2. In the new `integration/<source>` package, receive webhooks and publish
   `INTEGRATION_EVENT_RECEIVED` with `source: '<name>'`, `event: '<type>'`,
   and the payload.
3. Extend `TriggerPayload` in `@shipfox/api-workflows` with the new
   `(source, event)` arms so the run table preserves typing.
4. Update the triggers module's `on-integration-event-received` subscriber
   to know how to resolve the project for the new source (e.g. `getProjectBySource`
   for repository-backed sources) and how to evaluate the YAML `on` field for
   that event.

No changes are needed to the projection schema, the manual fire route, or
the run table — the columns are open-ended strings.
