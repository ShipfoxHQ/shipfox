import {E2eApiError, pollUntil} from '@shipfox/e2e-core';
import {waitForListenerExecution} from '#listener-helpers.js';
import {
  cleanupListenerCase,
  fireManualRun,
  LISTENER_JOB,
  type ListenerCase,
  listenerWorkflows,
  sendFire,
  setupListenerCase,
  stopRunner,
} from '#listener-jobs.js';
import {expect, test} from './fixtures.js';

const LISTENER_EXECUTION_TIMEOUT_MS = 90_000;
const CANCEL_TIMEOUT_MS = 90_000;

interface RunUsage {
  job_executions: {job_key: string | null; project_id: string; status: string | null}[];
}

async function projectStatus(testCase: ListenerCase): Promise<number> {
  try {
    await testCase.client.request('get', `/projects/${testCase.project.id}`);
    return 200;
  } catch (error) {
    if (error instanceof E2eApiError) return error.status;
    throw error;
  }
}

test('deleting a project cancels its running listening job and hides the project', async ({
  suite,
}, testInfo) => {
  let testCase: (ListenerCase & {definitionId: string}) | undefined;
  let runId: string | undefined;
  try {
    await test.step('start a listener execution', async () => {
      testCase = await setupListenerCase({
        suite,
        testName: 'project-deletion',
        // Its listener execution sleeps, so it is still running when the project goes.
        workflowYaml: listenerWorkflows.cancelOnResolve,
        attach: (attachment) =>
          testInfo.attach(attachment.name, {
            body: attachment.body,
            contentType: attachment.contentType,
          }),
      });
      runId = await fireManualRun(testCase);
      await sendFire(testCase, runId, 'fire', 'slow');
      await waitForListenerExecution({
        token: testCase.token,
        runId,
        jobKey: LISTENER_JOB,
        sequence: 1,
        status: 'running',
        timeoutMs: LISTENER_EXECUTION_TIMEOUT_MS,
      });
    });

    await test.step('delete the project', async () => {
      if (!testCase) throw new Error('Listener case was not set up');
      const response = await testCase.client.request('delete', `/projects/${testCase.project.id}`, {
        json: {name: testCase.project.name},
      });
      expect(response.status).toBe(204);
    });

    await test.step('the project is gone', async () => {
      if (!testCase) throw new Error('Listener case was not set up');
      expect(await projectStatus(testCase)).toBe(404);
      const list = await testCase.client.requestJson<{projects: {id: string}[]}>(
        'get',
        `/projects?workspace_id=${testCase.workspaceId}&search=${encodeURIComponent(testCase.project.name)}`,
      );
      expect(list.projects.map((project) => project.id)).not.toContain(testCase.project.id);
    });

    await test.step('the running listener execution is canceled', async () => {
      if (!testCase || !runId) throw new Error('Listener run was not started');
      const currentCase = testCase;
      const currentRunId = runId;
      // The run itself is purged with the project. Usage keeps its records for metering, so they
      // show how the execution ended.
      const execution = await pollUntil(
        {
          timeoutMs: CANCEL_TIMEOUT_MS,
          describe: () => `a cancelled usage record for run ${currentRunId}`,
        },
        async () => {
          const usage = await currentCase.client.requestJson<RunUsage>(
            'get',
            `/usage/workspaces/${currentCase.workspaceId}/runs/${currentRunId}`,
          );
          return (
            usage.job_executions.find(
              (record) => record.job_key === LISTENER_JOB && record.status !== null,
            ) ?? null
          );
        },
      );
      expect(execution.status).toBe('cancelled');
      expect(execution.project_id).toBe(currentCase.project.id);
    });
  } catch (error) {
    await cleanupListenerCase(testCase, runId);
    throw error;
  } finally {
    await stopRunner(testCase);
  }
});
