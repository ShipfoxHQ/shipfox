import {GITHUB_STATELESS_INSTALLATION_TOKEN, startGithubApiMock} from './github-api.js';

const TIP = 'b'.repeat(40);
const HEADERS = {
  authorization: `bearer ${GITHUB_STATELESS_INSTALLATION_TOKEN}`,
  'content-type': 'application/json',
};

describe('GitHub API mock check runs', () => {
  it('adds a check run to its commit, updates it, and lists it', async () => {
    const mock = await startGithubApiMock({endpoint: new URL('http://127.0.0.1:0')});
    const request = (method: string, path: string, body?: Record<string, unknown>) =>
      fetch(new URL(path, mock.endpoint), {
        method,
        headers: HEADERS,
        ...(body === undefined ? {} : {body: JSON.stringify(body)}),
      });

    try {
      mock.commits.set(TIP, {repository: 'acme/app', message: 'Tip', checkRuns: [{name: 'build'}]});
      const created = await request('POST', '/repos/acme/app/check-runs', {
        name: 'Contract check',
        head_sha: TIP,
        status: 'in_progress',
      });
      const {id} = (await created.json()) as {id: number};
      const updated = await request('PATCH', `/repos/acme/app/check-runs/${id}`, {
        status: 'completed',
        conclusion: 'success',
        output: {title: 'Passed', summary: 'All good'},
      });
      const missing = await request('PATCH', '/repos/acme/app/check-runs/1', {name: 'x'});
      const unknownCommit = await request('POST', '/repos/acme/app/check-runs', {
        name: 'Orphan',
        head_sha: 'c'.repeat(40),
      });
      const incomplete = await request('PATCH', `/repos/acme/app/check-runs/${id}`, {
        status: 'bogus',
      });
      const list = await request('GET', `/repos/acme/app/commits/${TIP}/check-runs`);

      expect(created.status).toBe(201);
      await expect(updated.json()).resolves.toMatchObject({
        id,
        status: 'completed',
        conclusion: 'success',
        output: {title: 'Passed', summary: 'All good'},
      });
      expect(missing.status).toBe(404);
      expect(unknownCommit.status).toBe(422);
      expect(incomplete.status).toBe(422);
      await expect(list.json()).resolves.toMatchObject({
        total_count: 2,
        check_runs: [
          {name: 'build'},
          {id, name: 'Contract check', status: 'completed', output: {title: 'Passed'}},
        ],
      });
      expect(mock.writes().map((write) => write.kind)).toEqual([
        'github.create_check_run',
        'github.update_check_run',
      ]);
    } finally {
      await mock.stop();
    }
  });

  it('answers a configured response instead of storing the check run', async () => {
    const mock = await startGithubApiMock({
      endpoint: new URL('http://127.0.0.1:0'),
      checkRunCreateResponse: {id: 7, status: 'in_progress'},
    });

    try {
      const response = await fetch(new URL('/repos/acme/app/check-runs', mock.endpoint), {
        method: 'POST',
        headers: HEADERS,
        body: JSON.stringify({name: 'x', head_sha: TIP}),
      });

      await expect(response.json()).resolves.toEqual({id: 7, status: 'in_progress'});
      expect(mock.writes()).toEqual([]);
    } finally {
      await mock.stop();
    }
  });
});
