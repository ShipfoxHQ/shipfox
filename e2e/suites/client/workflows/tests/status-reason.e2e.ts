import {createApiClient, E2eApiError, pollUntil} from '@shipfox/e2e-core';
import type {WorkspaceFixtures} from '@shipfox/e2e-kit/fixtures';
import {waitForRunTerminal} from '@shipfox/e2e-observe-workflows';
import type {WorkflowsScreenFixtures} from '@shipfox/e2e-screens-workflows';
import type {Page} from '@shipfox/playwright';
import {expect, test} from './test.js';

const WORKFLOW_YAML = `
name: Status reason browser screen
runner: e2e
triggers:
  manual:
    source: manual
    event: fire
jobs:
  skipped:
    if: '${'$'}{{ false }}'
    steps:
      - run: echo never-started
`;

interface DefinitionResponse {
  id: string;
}

interface ManualLaunchResponse {
  workflow_run_id: string;
}

test('reads a job status reason from the workflow run page', async ({
  createReadyWorkspace,
  page,
  workflowRun,
}: WorkspaceFixtures & WorkflowsScreenFixtures & {page: Page}) => {
  const {projectId, sessionToken, workspaceSlug} = await createReadyWorkspace({
    name: 'Workflow run screen workspace',
  });
  const client = createApiClient({token: sessionToken});
  const definition = await client.requestJson<DefinitionResponse>('post', '/definitions', {
    json: {project_id: projectId, source: 'manual', yaml: WORKFLOW_YAML},
  });
  const launch = await pollUntil<ManualLaunchResponse>(
    {
      timeoutMs: 60_000,
      intervalMs: 250,
      maxIntervalMs: 4_000,
      backoffFactor: 1.5,
      describe: () => `manual trigger of definition ${definition.id}`,
    },
    async () => {
      try {
        return await client.requestJson<ManualLaunchResponse>(
          'post',
          `/workflow-definitions/${definition.id}/fire-manual`,
          {json: {}},
        );
      } catch (error) {
        if (!(error instanceof E2eApiError) || error.status !== 404) throw error;
        return null;
      }
    },
  );

  const run = await waitForRunTerminal({
    runId: launch.workflow_run_id,
    token: sessionToken,
    selection: {jobs: [{jobKey: 'skipped'}]},
  });
  expect(run.jobs.find((job) => job.key === 'skipped')?.status_reason).toBe('condition_rejected');

  await workflowRun.openRun(launch.workflow_run_id);
  await expect(page).toHaveURL(
    new RegExp(`/w/${workspaceSlug}/p/.+/runs/${launch.workflow_run_id}(?:\\?[^#]*)?/?$`, 'u'),
  );
  await workflowRun.job('skipped').open();
  await expect(workflowRun.job('skipped').statusReason()).toBeVisible();
  await expect(workflowRun.job('skipped').statusReason()).toContainText(
    'The if condition of this job is false.',
  );
  await expect(workflowRun.job('skipped').statusReason()).toHaveAttribute(
    'aria-label',
    'skipped logs',
  );
});
