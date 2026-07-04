# Workflow Runtime Core

Workflow runtime code is split into two independent subsystems: scheduling and step config.

## Workflow Scheduling

`core/workflow-scheduling` contains the pure DAG scheduler and run-progress helpers.

- **`scheduleRuntimeDag`** reads a runtime DAG, completed job statuses, and currently running jobs, then returns scheduling commands.
- **Runtime commands** describe host actions such as starting a job, skipping a job, cancelling a job, or completing a run.
- **Runtime DAG entities** define the small job shape the scheduler needs.
- **Run progress** tracks completed and skipped jobs while Temporal orchestration loops over scheduler decisions.

The scheduler does not call Temporal, runners, the database, or external systems. The host loads durable state, calls the scheduler, applies commands, persists rows, and waits for job results.

```ts
import {scheduleRuntimeDag} from '#core/workflow-scheduling/schedule-runtime-dag.js';

const commands = scheduleRuntimeDag({
  jobs: [
    {id: 'job-1', key: 'build', mode: 'one_shot', dependencies: [], version: 1},
    {id: 'job-2', key: 'test', mode: 'one_shot', dependencies: ['build'], version: 1},
  ],
  completed: new Map(),
  running: new Set(),
});
```

## Step Config

`core/step-config` owns workflow step config materialization and fill-site completion.

- **Run and execution assembly** builds `WorkflowEvaluationContext` values for run creation, execution creation, and step dispatch.
- **Materialization** converts a normalized workflow model into persisted job and step rows for a run or a single job execution.
- **Step config resolution** evaluates and freezes planned step config fields at the earliest server site that has the required roots.
- **Dispatch completion** fills any `step-dispatch` `config_plan` segments before a step is handed to a runner.

Step config starts from the authored workflow model. Authoring validation records each expression's roots and produces a `config_plan` for fields that may need more than one fill site. At run creation or execution creation, the materializer assembles a phase-tagged context and resolves fields whose roots are available at that site.

Fully resolved fields are frozen into `steps.config`. Deferred segments stay in the plan until their fill site. `completeStepDispatchConfig` handles the dispatch site, using the latest step context to finish server-side segments before the runner receives the step. Runner-only segments, such as secrets, remain references for runner fill and are never persisted as plaintext values.

The context wrapper is:

```ts
type WorkflowEvaluationContext = {
  site: AvailabilitySite;
  values: WorkflowExpressionEvaluationContext;
};
```

The `site` records where the fill is happening. The `values` object carries only the roots available there, such as `run`, `trigger`, `event`, `inputs`, `job`, `execution`, `executions`, and step data for dispatch.

```ts
import {assembleCreationContext} from '#core/step-config/assemble-run-context.js';
import {materializeWorkflowModel} from '#core/step-config/materialize-workflow-model.js';

const context = assembleCreationContext({
  run,
  triggerPayload,
  inputs,
});

const materialized = await materializeWorkflowModel({
  model,
  context,
  definitionId,
  resolveAgentDefaults,
});
```

## Development

```sh
turbo check --filter=@shipfox/api-workflows
turbo type --filter=@shipfox/api-workflows
turbo test --filter=@shipfox/api-workflows
```

DB-backed workflow tests need local Postgres from `docker compose up -d`.
