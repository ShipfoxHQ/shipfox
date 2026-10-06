import {GITHUB_STATELESS_INSTALLATION_TOKEN, startGithubApiMock} from './github-api.js';

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
});
