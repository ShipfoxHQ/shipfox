import {GITHUB_STATELESS_INSTALLATION_TOKEN, startGithubApiMock} from './github-api.js';

const POST_HEADERS = {
  ...{authorization: `bearer ${GITHUB_STATELESS_INSTALLATION_TOKEN}`},
  'content-type': 'application/json',
};

const HEADERS = {authorization: `bearer ${GITHUB_STATELESS_INSTALLATION_TOKEN}`};

async function startMock() {
  const mock = await startGithubApiMock({endpoint: new URL('http://127.0.0.1:0')});
  const get = (path: string) => fetch(new URL(path, mock.endpoint), {headers: HEADERS});
  mock.workflows.set(375_690_478, {repository: 'acme/app', name: 'Fixture', file: 'fixture.yml'});
  mock.workflows.set(375_690_479, {repository: 'acme/app', name: 'CI', file: 'ci.yml'});
  mock.workflows.set(1, {repository: 'acme/other', name: 'Other', file: 'other.yml'});
  return {mock, get};
}

describe('GitHub API mock actions', () => {
  it('lists the workflows of one repository', async () => {
    const {mock, get} = await startMock();

    try {
      const response = await get('/repos/acme/app/actions/workflows');

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({
        total_count: 2,
        workflows: [
          {
            id: 375_690_478,
            name: 'Fixture',
            path: '.github/workflows/fixture.yml',
            state: 'active',
          },
          {id: 375_690_479, name: 'CI', path: '.github/workflows/ci.yml', state: 'active'},
        ],
      });
    } finally {
      await mock.stop();
    }
  });

  it('answers an empty list for a repository without workflows', async () => {
    const {mock, get} = await startMock();

    try {
      const response = await get('/repos/acme/empty/actions/workflows');

      await expect(response.json()).resolves.toEqual({total_count: 0, workflows: []});
    } finally {
      await mock.stop();
    }
  });

  it('reads a workflow by id or by file name, and not across repositories', async () => {
    const {mock, get} = await startMock();

    try {
      const byFile = await get('/repos/acme/app/actions/workflows/fixture.yml');
      const byId = await get('/repos/acme/app/actions/workflows/375690478');
      const otherRepository = await get('/repos/acme/other/actions/workflows/fixture.yml');

      expect(byFile.status).toBe(200);
      await expect(byFile.json()).resolves.toMatchObject({id: 375_690_478, name: 'Fixture'});
      await expect(byId.json()).resolves.toMatchObject({id: 375_690_478, name: 'Fixture'});
      expect(otherRepository.status).toBe(404);
    } finally {
      await mock.stop();
    }
  });

  it('lists the runs of a workflow, newest first, with their run numbers', async () => {
    const {mock, get} = await startMock();

    try {
      mock.workflowRuns.set(10, {workflowId: 375_690_478, sha: 'a'.repeat(40)});
      mock.workflowRuns.set(11, {
        workflowId: 375_690_478,
        sha: 'b'.repeat(40),
        conclusion: 'failure',
      });
      mock.workflowRuns.set(12, {workflowId: 375_690_479, sha: 'c'.repeat(40)});
      const response = await get('/repos/acme/app/actions/workflows/fixture.yml/runs?per_page=5');

      await expect(response.json()).resolves.toMatchObject({
        total_count: 2,
        workflow_runs: [
          {
            id: 11,
            run_number: 2,
            status: 'completed',
            conclusion: 'failure',
            head_branch: 'main',
            workflow_id: 375_690_478,
          },
          {id: 10, run_number: 1, conclusion: 'success', head_sha: 'a'.repeat(40)},
        ],
      });
    } finally {
      await mock.stop();
    }
  });

  it('orders runs by id, whatever order they were seeded in', async () => {
    const {mock, get} = await startMock();

    try {
      mock.workflowRuns.set(12, {workflowId: 375_690_478, sha: 'a'.repeat(40)});
      mock.workflowRuns.set(10, {workflowId: 375_690_478, sha: 'b'.repeat(40)});
      const response = await get('/repos/acme/app/actions/workflows/fixture.yml/runs');

      await expect(response.json()).resolves.toMatchObject({
        workflow_runs: [
          {id: 12, run_number: 2},
          {id: 10, run_number: 1},
        ],
      });
    } finally {
      await mock.stop();
    }
  });

  it('answers an empty run list for a workflow with no runs, seeded or not', async () => {
    const {mock, get} = await startMock();

    try {
      const seeded = await get('/repos/acme/app/actions/workflows/ci.yml/runs');
      const unknown = await get('/repos/acme/app/actions/workflows/unknown.yml/runs');

      await expect(seeded.json()).resolves.toEqual({total_count: 0, workflow_runs: []});
      await expect(unknown.json()).resolves.toEqual({total_count: 0, workflow_runs: []});
    } finally {
      await mock.stop();
    }
  });

  it('pages the run list', async () => {
    const {mock, get} = await startMock();

    try {
      for (const id of [10, 11, 12]) {
        mock.workflowRuns.set(id, {workflowId: 375_690_478, sha: 'a'.repeat(40)});
      }
      const response = await get(
        '/repos/acme/app/actions/workflows/fixture.yml/runs?per_page=2&page=2',
      );

      await expect(response.json()).resolves.toMatchObject({
        total_count: 3,
        workflow_runs: [{id: 10}],
      });
    } finally {
      await mock.stop();
    }
  });

  it('reads a run with its jobs, artifacts, and timing, and not across repositories', async () => {
    const {mock, get} = await startMock();

    try {
      mock.workflowRuns.set(10, {workflowId: 375_690_478, sha: 'a'.repeat(40)});
      mock.workflowRuns.set(11, {
        workflowId: 375_690_478,
        sha: 'b'.repeat(40),
        jobs: [{name: 'build'}, {name: 'verify', conclusion: 'failure'}],
        artifacts: [{name: 'report'}],
      });
      const run = await get('/repos/acme/app/actions/runs/11');
      const jobs = await get('/repos/acme/app/actions/runs/11/jobs');
      const artifacts = await get('/repos/acme/app/actions/runs/11/artifacts');
      const timing = await get('/repos/acme/app/actions/runs/11/timing');
      const noJobs = await get('/repos/acme/app/actions/runs/10/jobs');
      const otherRepository = await get('/repos/acme/other/actions/runs/11');

      await expect(run.json()).resolves.toMatchObject({
        id: 11,
        run_number: 2,
        workflow_id: 375_690_478,
        status: 'completed',
        conclusion: 'success',
      });
      await expect(jobs.json()).resolves.toMatchObject({
        total_count: 2,
        jobs: [
          {id: 1101, run_id: 11, name: 'build', status: 'completed', conclusion: 'success'},
          {
            id: 1102,
            run_id: 11,
            name: 'verify',
            conclusion: 'failure',
            steps: [{name: 'Set up job'}, {}],
          },
        ],
      });
      await expect(artifacts.json()).resolves.toMatchObject({
        total_count: 1,
        artifacts: [{id: 1101, name: 'report', expired: false}],
      });
      await expect(timing.json()).resolves.toMatchObject({
        billable: {UBUNTU: {jobs: 2}},
        run_duration_ms: 4000,
      });
      await expect(noJobs.json()).resolves.toEqual({total_count: 0, jobs: []});
      expect(otherRepository.status).toBe(404);
    } finally {
      await mock.stop();
    }
  });

  it('reads a job by id and redirects the logs and artifact downloads', async () => {
    const {mock, get} = await startMock();

    try {
      mock.workflowRuns.set(11, {
        workflowId: 375_690_478,
        sha: 'b'.repeat(40),
        jobs: [{name: 'build'}, {name: 'verify', logs: 'Verified\n'}],
        artifacts: [{name: 'report'}],
      });
      const job = await get('/repos/acme/app/actions/jobs/1102');
      const missingJob = await get('/repos/acme/app/actions/jobs/1103');
      const noRedirect = {redirect: 'manual'} as const;
      const follow = (path: string) =>
        fetch(new URL(path, mock.endpoint), {headers: HEADERS, ...noRedirect});
      const jobLogs = await follow('/repos/acme/app/actions/jobs/1102/logs');
      const jobLogsText = await fetch(jobLogs.headers.get('location') ?? '');
      const missingJobLogsText = await fetch(
        new URL('/download/jobs/1103/logs.txt', mock.endpoint),
      );
      const runLogs = await follow('/repos/acme/app/actions/runs/11/logs');
      const artifact = await follow('/repos/acme/app/actions/artifacts/1101/zip');
      const missingArtifact = await follow('/repos/acme/app/actions/artifacts/1102/zip');

      await expect(job.json()).resolves.toMatchObject({id: 1102, name: 'verify', run_id: 11});
      expect(missingJob.status).toBe(404);
      expect(jobLogs.status).toBe(302);
      expect(jobLogs.headers.get('location')).toBe(
        new URL('/download/jobs/1102/logs.txt', mock.endpoint).toString(),
      );
      await expect(jobLogsText.text()).resolves.toBe('Verified\n');
      expect(missingJobLogsText.status).toBe(404);
      expect(runLogs.status).toBe(302);
      expect(runLogs.headers.get('location')).toContain('/download/runs/11/logs.zip');
      expect(artifact.status).toBe(302);
      expect(artifact.headers.get('location')).toContain('/download/artifacts/1101.zip');
      expect(missingArtifact.status).toBe(404);
    } finally {
      await mock.stop();
    }
  });

  it('dispatches a workflow that waits, and cancels and reruns its run', async () => {
    const {mock, get} = await startMock();
    const post = (path: string, body: Record<string, unknown> = {}) =>
      fetch(new URL(path, mock.endpoint), {
        method: 'POST',
        headers: POST_HEADERS,
        body: JSON.stringify(body),
      });

    try {
      mock.workflows.set(7, {
        repository: 'acme/app',
        name: 'Trigger',
        file: 'trigger.yml',
        runName: `Trigger \${{ inputs.marker }}`,
        outcomeInput: 'outcome',
      });
      const dispatched = await post('/repos/acme/app/actions/workflows/trigger.yml/dispatches', {
        ref: 'main',
        inputs: {marker: 'contract-1', outcome: 'wait'},
        return_run_details: true,
      });
      const {workflow_run_id: runId} = (await dispatched.json()) as {workflow_run_id: number};
      const run = () => get(`/repos/acme/app/actions/runs/${runId}`);
      const early = await post(`/repos/acme/app/actions/runs/${runId}/rerun`);
      const cancelled = await post(`/repos/acme/app/actions/runs/${runId}/cancel`);
      const cancelledAgain = await post(`/repos/acme/app/actions/runs/${runId}/cancel`);
      const afterCancel = await (await run()).json();
      const rerun = await post(`/repos/acme/app/actions/runs/${runId}/rerun`);
      const afterRerun = await (await run()).json();

      expect(dispatched.status).toBe(200);
      expect(early.status).toBe(403);
      expect(cancelled.status).toBe(202);
      expect(cancelledAgain.status).toBe(409);
      expect(afterCancel).toMatchObject({
        workflow_id: 7,
        event: 'workflow_dispatch',
        display_title: 'Trigger contract-1',
        run_attempt: 1,
        status: 'completed',
        conclusion: 'cancelled',
      });
      expect(rerun.status).toBe(201);
      expect(afterRerun).toMatchObject({run_attempt: 2, status: 'in_progress', conclusion: null});
      expect(mock.writes().map((write) => write.kind)).toEqual([
        'github.dispatch_workflow',
        'github.cancel_workflow_run',
        'github.rerun_workflow_run',
      ]);
    } finally {
      await mock.stop();
    }
  });

  it('fails a dispatched run at once, reruns its failed jobs, and deletes its logs', async () => {
    const {mock, get} = await startMock();
    const send = (method: string, path: string, body: Record<string, unknown> = {}) =>
      fetch(new URL(path, mock.endpoint), {
        method,
        headers: POST_HEADERS,
        ...(method === 'DELETE' ? {} : {body: JSON.stringify(body)}),
      });

    try {
      mock.workflows.set(7, {
        repository: 'acme/app',
        name: 'Trigger',
        file: 'trigger.yml',
        outcomeInput: 'outcome',
      });
      const noContent = await send('POST', '/repos/acme/app/actions/workflows/7/dispatches', {
        ref: 'main',
        inputs: {outcome: 'fail'},
      });
      const [runId] = [...mock.workflowRuns.keys()];
      const rerun = await send('POST', `/repos/acme/app/actions/runs/${runId}/rerun-failed-jobs`);
      const jobs = await (await get(`/repos/acme/app/actions/runs/${runId}/jobs`)).json();
      const [job] = (jobs as {jobs: Array<{id: number}>}).jobs;
      const logsBefore = await fetch(
        new URL(`/repos/acme/app/actions/jobs/${job?.id}/logs`, mock.endpoint),
        {headers: HEADERS, redirect: 'manual'},
      );
      const deleted = await send('DELETE', `/repos/acme/app/actions/runs/${runId}/logs`);
      const logsAfter = await get(`/repos/acme/app/actions/jobs/${job?.id}/logs`);
      const missingRef = await send('POST', '/repos/acme/app/actions/workflows/7/dispatches', {});

      expect(noContent.status).toBe(204);
      expect(rerun.status).toBe(201);
      expect(jobs).toMatchObject({
        jobs: [{name: 'Trigger', run_attempt: 2, status: 'completed', conclusion: 'failure'}],
      });
      expect(logsBefore.status).toBe(302);
      expect(deleted.status).toBe(204);
      expect(logsAfter.status).toBe(404);
      expect(missingRef.status).toBe(422);
    } finally {
      await mock.stop();
    }
  });
});
