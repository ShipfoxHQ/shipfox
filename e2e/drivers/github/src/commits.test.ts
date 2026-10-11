import {GITHUB_STATELESS_INSTALLATION_TOKEN, startGithubApiMock} from './github-api.js';

const BASE = 'a'.repeat(40);
const TIP = 'b'.repeat(40);

async function startMock() {
  const mock = await startGithubApiMock({endpoint: new URL('http://127.0.0.1:0')});
  const get = (path: string) =>
    fetch(new URL(path, mock.endpoint), {
      headers: {authorization: `bearer ${GITHUB_STATELESS_INSTALLATION_TOKEN}`},
    });
  mock.commits.set(BASE, {repository: 'acme/app', message: 'Seed the notes'});
  mock.commits.set(TIP, {
    repository: 'acme/app',
    message: 'Extend the notes',
    parents: [BASE],
    checkRuns: [{name: 'build'}, {name: 'verify', conclusion: 'failure'}],
  });
  mock.branchHeads.set('fixture/open-pr', TIP);
  return {mock, get};
}

describe('GitHub API mock commits', () => {
  it('reads a branch by name, with its tip commit, and answers Branch not found otherwise', async () => {
    const {mock, get} = await startMock();

    try {
      const branch = await get('/repos/acme/app/branches/fixture%2Fopen-pr');
      const missing = await get('/repos/acme/app/branches/fixture%2Fnone');
      const otherRepository = await get('/repos/acme/other/branches/fixture%2Fopen-pr');

      await expect(branch.json()).resolves.toMatchObject({
        name: 'fixture/open-pr',
        protected: false,
        commit: {sha: TIP, commit: {message: 'Extend the notes'}},
      });
      mock.branchHeads.set('fix/100%', TIP);
      const percent = await get('/repos/acme/app/branches/fix%2F100%25');

      await expect(percent.json()).resolves.toMatchObject({name: 'fix/100%', commit: {sha: TIP}});
      expect(missing.status).toBe(404);
      await expect(missing.json()).resolves.toMatchObject({message: 'Branch not found'});
      expect(otherRepository.status).toBe(404);
    } finally {
      await mock.stop();
    }
  });

  it('reads a commit by id or by branch name, with its parents', async () => {
    const {mock, get} = await startMock();

    try {
      const byId = await get(`/repos/acme/app/commits/${TIP}`);
      const byBranch = await get('/repos/acme/app/commits/fixture%2Fopen-pr');
      const unknown = await get(`/repos/acme/app/commits/${'c'.repeat(40)}`);

      await expect(byId.json()).resolves.toMatchObject({
        sha: TIP,
        commit: {message: 'Extend the notes', verification: {verified: false}},
        parents: [{sha: BASE}],
        author: {login: 'e2e-author'},
      });
      await expect(byBranch.json()).resolves.toMatchObject({sha: TIP});
      expect(unknown.status).toBe(422);
    } finally {
      await mock.stop();
    }
  });

  it('answers the combined status and the check runs of a commit', async () => {
    const {mock, get} = await startMock();

    try {
      const status = await get('/repos/acme/app/commits/fixture%2Fopen-pr/status');
      const checkRuns = await get('/repos/acme/app/commits/fixture%2Fopen-pr/check-runs');
      mock.commits.set(BASE, {
        repository: 'acme/app',
        message: 'Seed the notes',
        statuses: [{context: 'ci', state: 'failure'}],
      });
      const failing = await get(`/repos/acme/app/commits/${BASE}/status`);

      await expect(status.json()).resolves.toMatchObject({
        state: 'pending',
        sha: TIP,
        total_count: 0,
        statuses: [],
      });
      await expect(checkRuns.json()).resolves.toMatchObject({
        total_count: 2,
        check_runs: [
          {name: 'build', status: 'completed', conclusion: 'success', head_sha: TIP},
          {name: 'verify', status: 'completed', conclusion: 'failure'},
        ],
      });
      await expect(failing.json()).resolves.toMatchObject({
        state: 'failure',
        total_count: 1,
        statuses: [{context: 'ci', state: 'failure'}],
      });
    } finally {
      await mock.stop();
    }
  });

  it('compares a base with a branch along the first parents', async () => {
    const {mock, get} = await startMock();

    try {
      const ahead = await get(`/repos/acme/app/compare/${BASE}...fixture%2Fopen-pr`);
      const identical = await get(`/repos/acme/app/compare/${TIP}...${TIP}`);
      const behind = await get(`/repos/acme/app/compare/${TIP}...${BASE}`);

      await expect(ahead.json()).resolves.toMatchObject({
        status: 'ahead',
        ahead_by: 1,
        behind_by: 0,
        total_commits: 1,
        merge_base_commit: {sha: BASE},
        commits: [{sha: TIP, commit: {message: 'Extend the notes'}}],
      });
      await expect(identical.json()).resolves.toMatchObject({status: 'identical', commits: []});
      expect(behind.status).toBe(404);
    } finally {
      await mock.stop();
    }
  });
});
