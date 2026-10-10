# E2E Observe Workflows

E2E observations of workflow runs, jobs, executions, and steps, read through the public API.

## What it does

- **`waitForRunByCommit` and `waitForRunByDeliveryId`** wait for the run that a commit or a webhook delivery created.
- **`observeRun`** reads one run attempt as a `WorkflowRunObservation`, with jobs, executions, steps, and context only when the caller selects them.
- **`waitForRunTerminal`** polls a run until its attempt is `succeeded`, `failed`, or `cancelled`, then returns the observation.
- **`createWorkflowsHelper`** binds a token and API URL to the four functions.

Reads use the public routes, so an observation shows what a user of the API sees.

## Installation and setup

```sh
pnpm add @shipfox/e2e-observe-workflows @shipfox/e2e-core
```

The API under test needs no `/__e2e` route for these reads. Pass a session token that can read the run.

## Usage

Wait for a run to finish and read its jobs:

```ts
import {waitForRunTerminal} from '@shipfox/e2e-observe-workflows';

const run = await waitForRunTerminal({
  runId,
  token: session.token,
  selection: {jobs: [{jobKey: 'build', stepKeys: ['compile']}]},
});

console.log(run.attempt.status, run.jobs.map((job) => job.status));
```

## Environment

The package reads the variables listed in [E2E Core](../../core/README.md#environment).

## Development

Run the package checks from the repository root:

```sh
turbo check --filter=@shipfox/e2e-observe-workflows
turbo type --filter=@shipfox/e2e-observe-workflows
turbo build --filter=@shipfox/e2e-observe-workflows
turbo test --filter=@shipfox/e2e-observe-workflows
```

## License

MIT
