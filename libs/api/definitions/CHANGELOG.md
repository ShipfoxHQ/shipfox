# @shipfox/api-definitions

## 0.1.0

### Minor Changes

- 3afb7e3: Adds job execution success expressions and execution timeouts to workflow documents.
  Renames job execution IDs in auth, runner, workflow, and timeout event contracts to the explicit `jobExecutionId` / `job_execution_id` shape.
- 69d02e5: Adds job-level checkout permissions and persist-credentials fields to workflow documents.
- b74f635: Adds workflow run interpolation context resolution while preserving authored step configuration for reruns and diagnostics.

### Patch Changes

- eb40964: Add an inline `agent` workflow step that the runner runs with the pi harness. A step is an agent step when it carries `model` + `prompt` and no `run`; it takes a free-text `model`, a single `prompt`, and an optional `thinking` level (default `high`). The step runs to process-success (the agent ran to completion) and reports through the existing step protocol with no runner/backend protocol change, so change quality is judged by a downstream `run` + `gate` step. v1 does not persist the agent's work (no diff, commit, or PR).
- 59ba68b: Integrates workflow definitions with accepted workflow documents and normalized workflow models.
- 857879a: Add a definitions-owned workflow model normalizer for accepted workflow documents.
- ae7a63c: Adds daily dispatched outbox row retention with bounded cleanup batches and retention indexes on module outbox tables.
- b525dcd: Let an agent workflow step pick its pi provider with an optional free-text `provider` field (default `anthropic`), threaded to the runner's pi model lookup, and split agent-step failures into a user-fixable `agent_config_invalid` reason (unknown provider, missing runner credentials, wrong provider/model pair) versus `agent_invocation_failed` for genuine provider/API errors.
- f47cff8: Add a definitions-owned workflow YAML parser that returns a shared `WorkflowDocument`.
- 3bea87f: Adds a typed `subscriberFactory` that binds each outbox event name to its payload type at construction, so subscriber handlers receive a typed `(payload, event)` and the per-handler `event.payload as X` casts are gone; a private brand makes the factory the only way to build a module subscriber.
- ef1e917: Adds listening-job authoring fields and trusted execution context validation for listening jobs.
  Separates workflow identifiers so internal rows use UUID `id`, authored workflow/job/step
  references use `key`, and UI labels use `name`.
- 61de795: Adds canonical runner label validation and default runner label fallback for workflow definition parsing.
- 2933c33: Adds drain-boundary Zod validation for current outbox publisher event payloads.
- Updated dependencies [eb40964]
- Updated dependencies [067a260]
- Updated dependencies [34ba284]
- Updated dependencies [8f51daf]
- Updated dependencies [e689abf]
- Updated dependencies [59ba68b]
- Updated dependencies [b9c3f32]
- Updated dependencies [a81b68c]
- Updated dependencies [115655e]
- Updated dependencies [c0a883c]
- Updated dependencies [72ce351]
- Updated dependencies [cdf8989]
- Updated dependencies [e47f8da]
- Updated dependencies [a68ed61]
- Updated dependencies [1127ba2]
- Updated dependencies [de54da2]
- Updated dependencies [7b175f5]
- Updated dependencies [e9056c7]
- Updated dependencies [fd83878]
- Updated dependencies [f3614ae]
- Updated dependencies [f98c2be]
- Updated dependencies [ae7a63c]
- Updated dependencies [5729548]
- Updated dependencies [d245be8]
- Updated dependencies [f92122b]
- Updated dependencies [b525dcd]
- Updated dependencies [f8f339a]
- Updated dependencies [58f51bd]
- Updated dependencies [570ac69]
- Updated dependencies [857fd73]
- Updated dependencies [62c25a5]
- Updated dependencies [998eba3]
- Updated dependencies [3afb7e3]
- Updated dependencies [eb7d5e8]
- Updated dependencies [75520ff]
- Updated dependencies [b8e49ff]
- Updated dependencies [5b8ed32]
- Updated dependencies [417f128]
- Updated dependencies [d6d4862]
- Updated dependencies [c0a883c]
- Updated dependencies [6077301]
- Updated dependencies [9d3b43a]
- Updated dependencies [3bea87f]
- Updated dependencies [69d02e5]
- Updated dependencies [f63c6b0]
- Updated dependencies [ef1e917]
- Updated dependencies [61de795]
- Updated dependencies [27770eb]
- Updated dependencies [2933c33]
- Updated dependencies [6181819]
- Updated dependencies [ad6056b]
- Updated dependencies [9c149d1]
- Updated dependencies [f88aac9]
- Updated dependencies [b8919da]
  - @shipfox/workflow-document@1.1.0
  - @shipfox/api-agent-dto@0.1.0
  - @shipfox/node-fastify@0.2.0
  - @shipfox/expression@1.1.0
  - @shipfox/api-definitions-dto@0.0.1
  - @shipfox/api-auth-context@0.1.0
  - @shipfox/api-integration-core@0.1.0
  - @shipfox/api-projects@0.0.1
  - @shipfox/node-opentelemetry@0.4.2
  - @shipfox/node-postgres@0.3.2
  - @shipfox/node-temporal@0.1.1
  - @shipfox/node-module@0.1.0
  - @shipfox/node-outbox@0.1.0
  - @shipfox/node-drizzle@0.1.0
  - @shipfox/runner-labels@0.0.1
  - @shipfox/api-projects-dto@0.0.1
  - @shipfox/config@1.2.0
