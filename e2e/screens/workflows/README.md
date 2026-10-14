# E2E Workflow Screens

Typed browser page objects for workflow run pages and job notices.

## What it does

- **`WorkflowRunScreen`** opens a workflow run and exposes its jobs and required action.
- **`WorkflowRunJobScreen`** opens a job and reads its status reason region.
- **`RequiredActionScreen`** reads and follows the action in the current notice.
- **`WorkflowsScreenFixtures` and `workflowsScreens`** add the workflow screens to a Playwright fixture.

## Installation and setup

Install the screen package with the E2E test tools:

```sh
pnpm add @shipfox/e2e-screens-workflows @shipfox/e2e-kit @shipfox/e2e-core
```

The consumer must configure its API and client URLs through the E2E kit before running a suite.

## Usage

Compose the workflow screens into a client suite:

```ts
import {test as base} from '@shipfox/e2e-core/playwright';
import {workflowsScreens} from '@shipfox/e2e-screens-workflows';

const test = base.extend({...workflowsScreens});

test('reads a job status reason', async ({workflowRun}) => {
  await workflowRun.openRun('run-id');
  await workflowRun.job('build').open();
  await workflowRun.job('build').statusReason().waitFor();
});
```

`openRun` uses the run permalink. The client resolves it to the workspace and project route.

## Development

Run the package checks from the repository root:

```sh
turbo check --filter=@shipfox/e2e-screens-workflows
turbo type --filter=@shipfox/e2e-screens-workflows
turbo build --filter=@shipfox/e2e-screens-workflows
turbo depcruise --filter=@shipfox/e2e-screens-workflows
```

## License

MIT
