import {afterEach, describe, expect, it} from '@shipfox/vitest/vi';
import {type GithubContractAccess, githubContractFake} from './github.js';
import {CONTRACT_FAKE_ADAPTERS} from './index.js';
import type {ContractFake, SandboxFixtures} from './shared.js';

const missingRepositoryPattern = /issue fixture needs a repository fixture/u;
const workflowNeedsRepositoryPattern = /workflow fixture needs a repository fixture/u;
const branchNeedsRepositoryPattern = /branch fixture needs a repository fixture/u;
const commitNeedsRepositoryPattern = /commit fixture needs a repository fixture/u;
const missingOwnerPattern = /fixture "repository" has no "owner"/u;

describe('githubContractFake', () => {
  const cleanups: Array<() => Promise<void>> = [];

  afterEach(async () => {
    for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  });

  function arrange() {
    return githubContractFake({uniqueId: 'abc1234', cleanups});
  }

  async function request({fake, path}: {fake: ContractFake<GithubContractAccess>; path: string}) {
    const baseUrl = fake.env.GITHUB_API_BASE_URL;
    if (baseUrl === undefined) throw new Error('The GitHub fake has no GITHUB_API_BASE_URL.');
    return await fetch(new URL(path, baseUrl), {
      headers: {authorization: `token ${fake.access.installationToken}`},
    });
  }

  async function read({fake, path}: {fake: ContractFake<GithubContractAccess>; path: string}) {
    return (await (await request({fake, path})).json()) as Record<string, unknown>;
  }

  it('serves the fixture issue from the fixture repository, with the same number and fields', async () => {
    const fake = await arrange();
    const fixtures: SandboxFixtures = {
      repository: {owner: 'contracts-sandbox', name: 'fixtures'},
      issue: {number: 7, title: 'Read fixture', body: 'Body', state: 'closed'},
    };

    await fake.seed(fixtures);

    const response = await request({fake, path: '/repos/contracts-sandbox/fixtures/issues/7'});
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      number: 7,
      title: 'Read fixture',
      body: 'Body',
      state: 'closed',
    });
  });

  it('seeds the issues, pull requests, label, and workflow the C7 cases read', async () => {
    const fake = await arrange();
    const base = '/repos/contracts-sandbox/fixtures';

    await fake.seed({
      repository: {owner: 'contracts-sandbox', name: 'fixtures'},
      issue: {number: 1, title: 'Fixture issue'},
      closed_issue: {number: 2, title: 'Fixture closed'},
      label: {name: 'contract-fixture'},
      pull_request: {number: 35, title: 'Fixture PR: open'},
      closed_pull_request: {number: 36, title: 'Fixture PR: closed'},
      merged_pull_request: {number: 37, title: 'Fixture PR: merged'},
      workflow: {id: 375_690_478, file: 'fixture.yml', name: 'Fixture'},
    });

    expect(await read({fake, path: `${base}/issues/1`})).toMatchObject({
      state: 'open',
      labels: [{name: 'contract-fixture'}],
    });
    expect(await read({fake, path: `${base}/issues/2`})).toMatchObject({state: 'closed'});
    expect(await read({fake, path: `${base}/pulls/35`})).toMatchObject({
      number: 35,
      state: 'open',
      merged: false,
      head: {ref: expect.any(String)},
      base: {ref: 'main'},
    });
    expect(await read({fake, path: `${base}/pulls/36`})).toMatchObject({
      state: 'closed',
      merged: false,
    });
    expect(await read({fake, path: `${base}/pulls/37`})).toMatchObject({
      state: 'closed',
      merged: true,
    });
    expect(await read({fake, path: `${base}/actions/workflows/fixture.yml`})).toMatchObject({
      id: 375_690_478,
      name: 'Fixture',
    });
    expect(await read({fake, path: `${base}/actions/workflows/fixture.yml/runs`})).toMatchObject({
      total_count: 2,
      workflow_runs: [
        {status: 'completed', conclusion: 'success'},
        {status: 'completed', conclusion: 'success'},
      ],
    });
  });

  it('seeds the sub-issue link, the comments, the pinned branch and commit, and the review of the open pull request', async () => {
    const fake = await arrange();
    const base = '/repos/contracts-sandbox/fixtures';
    const oid = '8c2d6bf2700044628216c6daf699870ef9e0915a';
    const baseOid = 'a7d8de632b46c87cb8d6df0377755825732e461e';

    await fake.seed({
      repository: {owner: 'contracts-sandbox', name: 'fixtures'},
      issue: {number: 1, title: 'Fixture issue', comment_count: 3},
      issue_comment: {id: 6_000_362_435, author: 'noe-charmet', body: 'Comment 1: café 日本語 🚀'},
      parent_issue: {number: 3, title: 'Parent'},
      sub_issue: {number: 4, title: 'Sub-issue'},
      pull_request: {number: 35, title: 'Fixture PR: open', head_ref: 'fixture/open-pr'},
      branch: {name: 'fixture/open-pr', oid},
      commit: {oid, message: 'Extend the notes', base_oid: baseOid},
      workflow: {id: 375_690_478, file: 'fixture.yml', name: 'Fixture'},
    });

    expect(await read({fake, path: `${base}/issues/1/comments`})).toMatchObject([
      {id: 6_000_362_435, body: 'Comment 1: café 日本語 🚀', user: {login: 'noe-charmet'}},
      {id: 2, body: 'Comment 2: café 日本語', user: {login: 'e2e-author'}},
      {id: 3, body: 'Comment 3: café 日本語'},
    ]);
    expect(await read({fake, path: `${base}/issues/3/sub_issues`})).toMatchObject([{number: 4}]);
    expect(await read({fake, path: `${base}/issues/4/parent`})).toMatchObject({number: 3});
    expect(await read({fake, path: `${base}/branches/fixture%2Fopen-pr`})).toMatchObject({
      commit: {sha: oid},
    });
    expect(
      await read({fake, path: `${base}/compare/${baseOid}...fixture%2Fopen-pr`}),
    ).toMatchObject({
      status: 'ahead',
      ahead_by: 1,
      merge_base_commit: {sha: baseOid},
    });
    expect(await read({fake, path: `${base}/pulls/35`})).toMatchObject({
      head: {ref: 'fixture/open-pr', sha: oid},
    });
    expect(await read({fake, path: `${base}/pulls/35/commits`})).toMatchObject([
      {sha: oid, commit: {message: 'Extend the notes'}},
    ]);
    expect(await read({fake, path: `${base}/pulls/35/files`})).toMatchObject([
      {filename: 'fixtures/notes.md', status: 'modified'},
      {filename: 'fixtures/extra.txt', status: 'added'},
    ]);
    expect(await read({fake, path: `${base}/pulls/35/reviews`})).toMatchObject([
      {state: 'COMMENTED', body: 'Review with threads.'},
    ]);
    expect(await read({fake, path: `${base}/pulls/35/comments`})).toMatchObject([
      {path: 'fixtures/notes.md', body: 'First thread: why four?'},
      {in_reply_to_id: 7001},
      {body: 'Second thread: a typo.'},
    ]);
    expect(await read({fake, path: `${base}/commits/fixture%2Fopen-pr/check-runs`})).toMatchObject({
      total_count: 2,
      check_runs: [{name: 'build'}, {name: 'verify', conclusion: 'success'}],
    });
    expect(await read({fake, path: `${base}/commits/fixture%2Fopen-pr/status`})).toMatchObject({
      sha: oid,
      total_count: 0,
    });
  });

  it('gives each seeded run the jobs and the artifact the sandbox workflow makes', async () => {
    const fake = await arrange();
    const base = '/repos/contracts-sandbox/fixtures/actions';

    await fake.seed({
      repository: {owner: 'contracts-sandbox', name: 'fixtures'},
      workflow: {id: 375_690_478, file: 'fixture.yml', name: 'Fixture'},
    });
    const runs = (await read({fake, path: `${base}/workflows/fixture.yml/runs?per_page=2`})) as {
      workflow_runs: Array<{id: number}>;
    };
    const runId = runs.workflow_runs[1]?.id;

    expect(await read({fake, path: `${base}/runs/${runId}/jobs`})).toMatchObject({
      total_count: 2,
      jobs: [{name: 'build'}, {name: 'verify'}],
    });
    expect(await read({fake, path: `${base}/runs/${runId}/artifacts`})).toMatchObject({
      total_count: 1,
      artifacts: [{name: 'report', expired: false}],
    });
  });

  it('seeds only the issues the sandbox has', async () => {
    const fake = await arrange();

    await fake.seed({repository: {owner: 'contracts-sandbox', name: 'fixtures'}});

    expect(await read({fake, path: '/repos/contracts-sandbox/fixtures/issues?state=all'})).toEqual(
      [],
    );
  });

  it('seeds nothing for a manifest without GitHub fixtures', async () => {
    const fake = await arrange();

    await fake.seed({});

    // The fake answers 404 for a repository it was not given.
    expect(
      (await request({fake, path: '/repos/contracts-sandbox/fixtures/issues?state=all'})).status,
    ).toBe(404);
  });

  it('rejects an issue without a repository, and a repository without an owner', async () => {
    const fake = await arrange();

    await expect(fake.seed({issue: {number: 1}})).rejects.toThrow(missingRepositoryPattern);
    await expect(fake.seed({workflow: {id: 1}})).rejects.toThrow(workflowNeedsRepositoryPattern);
    await expect(fake.seed({branch: {name: 'b', oid: 'a'}})).rejects.toThrow(
      branchNeedsRepositoryPattern,
    );
    await expect(fake.seed({commit: {oid: 'a'}})).rejects.toThrow(commitNeedsRepositoryPattern);
    await expect(fake.seed({repository: {name: 'fixtures'}})).rejects.toThrow(missingOwnerPattern);
  });

  it('answers 404 for a repository the sandbox does not have, and for an inaccessible target', async () => {
    const fake = await arrange();
    const status = async (name: string) =>
      (await request({fake, path: `/repos/contracts-sandbox/${name}/issues/1`})).status;

    await fake.seed({
      repository: {owner: 'contracts-sandbox', name: 'fixtures'},
      issue: {number: 1},
    });
    fake.deny?.({
      private_repository: {kind: 'inaccessible', owner: 'contracts-sandbox', name: 'private'},
    });

    expect(await status('fixtures')).toBe(200);
    expect(await status('absent')).toBe(404);
    expect(await status('private')).toBe(404);
  });

  it('stops the fake with the run cleanups', async () => {
    const fake = await arrange();

    for (const cleanup of cleanups.splice(0).reverse()) await cleanup();

    await expect(
      request({fake, path: '/repos/contracts-sandbox/fixtures/issues/1'}),
    ).rejects.toThrow();
  });

  it('is the adapter of the github provider', () => {
    expect(CONTRACT_FAKE_ADAPTERS.github).toBe(githubContractFake);
  });
});
