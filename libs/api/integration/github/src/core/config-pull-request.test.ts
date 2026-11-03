import {RequestError} from 'octokit';
import type {GithubToolClient} from './agent-tools.js';
import {findGithubConfigPullRequest, openGithubConfigPullRequest} from './config-pull-request.js';

const BASE = 'a'.repeat(40);
const TREE = 'b'.repeat(40);
const COMMIT = 'c'.repeat(40);
const NEW_TREE = 'd'.repeat(40);

const target = {owner: 'acme', repo: 'app', branch: 'shipfox/link-config-1'};
const input = {
  ...target,
  defaultBranch: 'main',
  files: [{path: '.shipfox/workflows/a.yml', content: 'name: A\n'}],
  title: 'Add Shipfox config',
  body: 'Body',
};

function pull(overrides: Record<string, unknown> = {}) {
  return {html_url: 'https://github.com/acme/app/pull/7', number: 7, state: 'open', ...overrides};
}

function githubError(message: string, status: number) {
  return new RequestError(message, status, {
    request: {method: 'GET', url: 'https://api.github.com/repos/acme/app', headers: {}},
  });
}

function notFound() {
  return githubError('Not Found', 404);
}

/** A GitHub that answers by route, so a test only states what differs. */
function githubClient(routes: Record<string, (parameters: Record<string, unknown>) => unknown>) {
  const calls: Array<{route: string; parameters: Record<string, unknown>}> = [];
  const client: GithubToolClient = {
    request: (route, parameters) => {
      calls.push({route, parameters});
      const handler = routes[route];
      if (!handler) throw new Error(`Unexpected GitHub route ${route}`);
      try {
        return Promise.resolve({data: handler(parameters)});
      } catch (error) {
        return Promise.reject(error);
      }
    },
  };
  return {client, calls};
}

describe('findGithubConfigPullRequest', () => {
  it('looks up the branch in every state', async () => {
    const {client, calls} = githubClient({'GET /repos/{owner}/{repo}/pulls': () => [pull()]});

    const found = await findGithubConfigPullRequest(client, target);

    expect(found).toEqual({url: 'https://github.com/acme/app/pull/7', number: 7, state: 'open'});
    expect(calls[0]?.parameters).toMatchObject({head: 'acme:shipfox/link-config-1', state: 'all'});
  });

  it('reads a merged pull request', async () => {
    const {client} = githubClient({
      'GET /repos/{owner}/{repo}/pulls': () => [
        pull({state: 'closed', merged_at: '2026-01-01T00:00:00Z'}),
      ],
    });

    expect((await findGithubConfigPullRequest(client, target))?.state).toBe('merged');
  });

  it('reads a pull request closed without a merge', async () => {
    const {client} = githubClient({
      'GET /repos/{owner}/{repo}/pulls': () => [pull({state: 'closed', merged_at: null})],
    });

    expect((await findGithubConfigPullRequest(client, target))?.state).toBe('closed');
  });

  it('answers null when no pull request came from the branch', async () => {
    const {client} = githubClient({'GET /repos/{owner}/{repo}/pulls': () => []});

    expect(await findGithubConfigPullRequest(client, target)).toBeNull();
  });
});

describe('openGithubConfigPullRequest', () => {
  function fresh(overrides: Record<string, (p: Record<string, unknown>) => unknown> = {}) {
    let branchExists = false;
    return githubClient({
      'GET /repos/{owner}/{repo}/pulls': () => [],
      'GET /repos/{owner}/{repo}/git/ref/heads/{branch}': (parameters) => {
        if (parameters.branch === 'main') return {object: {sha: BASE}};
        if (!branchExists) throw notFound();
        return {object: {sha: COMMIT}};
      },
      'GET /repos/{owner}/{repo}/git/commits/{commit_sha}': () => ({sha: BASE, tree: {sha: TREE}}),
      'POST /repos/{owner}/{repo}/git/trees': () => ({sha: NEW_TREE}),
      'POST /repos/{owner}/{repo}/git/commits': () => ({
        sha: COMMIT,
        html_url: 'https://github.com/acme/app/commit/c',
      }),
      'PATCH /repos/{owner}/{repo}/git/refs/heads/{branch}': () => {
        throw githubError('Reference does not exist', 422);
      },
      'POST /repos/{owner}/{repo}/git/refs': () => {
        branchExists = true;
        return {};
      },
      'POST /repos/{owner}/{repo}/pulls': () => pull(),
      ...overrides,
    });
  }

  it('commits the files on a new branch and opens the pull request', async () => {
    const {client, calls} = fresh();

    const opened = await openGithubConfigPullRequest(client, input);

    expect(opened).toEqual({url: 'https://github.com/acme/app/pull/7', number: 7, state: 'open'});
    const tree = calls.find((call) => call.route === 'POST /repos/{owner}/{repo}/git/trees');
    expect(tree?.parameters).toMatchObject({
      base_tree: TREE,
      tree: [{path: '.shipfox/workflows/a.yml', content: 'name: A\n', mode: '100644'}],
    });
    const pullCall = calls.find((call) => call.route === 'POST /repos/{owner}/{repo}/pulls');
    expect(pullCall?.parameters).toMatchObject({
      head: 'shipfox/link-config-1',
      base: 'main',
      title: 'Add Shipfox config',
    });
  });

  it('returns the pull request that already exists without writing', async () => {
    const {client, calls} = fresh({
      'GET /repos/{owner}/{repo}/pulls': () => [pull({number: 3})],
    });

    const opened = await openGithubConfigPullRequest(client, input);

    expect(opened.number).toBe(3);
    expect(calls.map((call) => call.route)).toEqual(['GET /repos/{owner}/{repo}/pulls']);
  });

  it('returns a closed pull request as it is instead of opening another', async () => {
    const {client} = fresh({
      'GET /repos/{owner}/{repo}/pulls': () => [pull({state: 'closed'})],
    });

    expect((await openGithubConfigPullRequest(client, input)).state).toBe('closed');
  });

  it('reuses a branch a lost response left behind', async () => {
    const {client, calls} = fresh({
      'GET /repos/{owner}/{repo}/git/ref/heads/{branch}': () => ({object: {sha: COMMIT}}),
    });

    await openGithubConfigPullRequest(client, input);

    const routes = calls.map((call) => call.route);
    expect(routes).not.toContain('POST /repos/{owner}/{repo}/git/commits');
    expect(routes).toContain('POST /repos/{owner}/{repo}/pulls');
  });

  it('finds the pull request a concurrent attempt opened', async () => {
    let lookups = 0;
    const {client} = fresh({
      'GET /repos/{owner}/{repo}/pulls': () => {
        lookups += 1;
        return lookups === 1 ? [] : [pull({number: 9})];
      },
      'POST /repos/{owner}/{repo}/pulls': () => {
        throw githubError('Validation Failed: A pull request already exists for acme:branch.', 422);
      },
    });

    expect((await openGithubConfigPullRequest(client, input)).number).toBe(9);
  });

  it('refuses a repository whose default branch has no commit', async () => {
    const {client} = githubClient({
      'GET /repos/{owner}/{repo}/pulls': () => [],
      'GET /repos/{owner}/{repo}/git/ref/heads/{branch}': () => {
        throw notFound();
      },
    });

    await expect(openGithubConfigPullRequest(client, input)).rejects.toMatchObject({
      reason: 'ref-not-found',
    });
  });

  it('surfaces a provider refusal', async () => {
    const {client} = fresh({
      'POST /repos/{owner}/{repo}/pulls': () => {
        throw githubError('Resource not accessible by integration', 403);
      },
    });

    await expect(openGithubConfigPullRequest(client, input)).rejects.toMatchObject({
      reason: 'provider-rejected',
      status: 403,
    });
  });
});
