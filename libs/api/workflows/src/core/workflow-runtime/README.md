# Workflow Runtime

Pure scheduling decisions for workflow run orchestration.

## What it does

- **`scheduleRuntimeDag`**: Reads a runtime DAG and completed job statuses, then returns the next scheduling commands.
- **`materializeWorkflowModel`**: Converts a normalized workflow model into the job and step shape persisted for a run.
- **Runtime commands**: Describe host actions such as starting a job, cancelling a job, or completing a run.
- **Runtime DAG entities**: Define the small job and step shape the scheduler needs.

## Usage

```ts
import {scheduleRuntimeDag} from '#core/workflow-runtime/index.js';

const commands = scheduleRuntimeDag({
  jobs: [
    {id: 'job-1', name: 'build', dependencies: [], version: 1, steps: []},
    {id: 'job-2', name: 'test', dependencies: ['build'], version: 1, steps: []},
  ],
  completed: new Map(),
  running: new Set(),
});
```

## Behavior Notes

The runtime module does not call Temporal, runners, the database, or external systems. It only returns commands and plain data. The durable host loads state, calls the scheduler, applies commands, persists rows, and waits for job results.

This split keeps the rule easy to test. Given the same jobs and the same completed map, the function gives the same answer. The host can then do the slow work in the right place.

Use this module when code needs to know what should happen next. Do not use it to save data, send work, or wait for a job. Those steps belong to the host around it.

For example, a run can have one build job and one test job. If the build job has not run yet, the function says to start it. If the build job failed, the function says to cancel the test job and end the run as failed.

The scheduler also accepts a `running` set. Jobs in that set have already been started by the host but have not completed yet. The scheduler will not start them again, and it will return no command when it must wait for a running job before more jobs can be scheduled.

`materializeWorkflowModel` also serializes step gates into step config. It keeps
the accepted `success_if` expression and `on_failure` action with the step that
will run. It does not evaluate the expression or restart jobs. That work belongs
to a later host change.

## Development

```sh
turbo check --filter=@shipfox/api-workflows
turbo type --filter=@shipfox/api-workflows
turbo test --filter=@shipfox/api-workflows
```

DB-backed workflow tests need local Postgres from `docker compose up -d`.

## License

MIT
