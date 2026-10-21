import {afterEach, describe, expect, it} from '@shipfox/vitest/vi';
import {CONTRACT_FAKE_ADAPTERS} from './index.js';
import {type JiraContractAccess, jiraContractFake} from './jira.js';
import type {ContractFake, SandboxFixtures} from './shared.js';

describe('jiraContractFake', () => {
  let cleanups: Array<() => Promise<void>> = [];

  afterEach(async () => {
    for (const cleanup of cleanups.reverse()) await cleanup();
    cleanups = [];
  });

  async function arrange() {
    return await jiraContractFake({uniqueId: 'unique', cleanups});
  }

  async function get({fake, path}: {fake: ContractFake<JiraContractAccess>; path: string}) {
    const baseUrl = fake.env.JIRA_API_BASE_URL;
    if (baseUrl === undefined) throw new Error('The Jira fake has no JIRA_API_BASE_URL.');
    const response = await fetch(new URL(`/ex/jira/cloud/rest/api/3${path}`, baseUrl), {
      headers: {authorization: `Bearer ${fake.access.accessToken}`},
    });
    return {status: response.status, body: (await response.json()) as Record<string, unknown>};
  }

  const fixtures: SandboxFixtures = {
    read_project: {key: 'READ', id: '10001', name: 'Read project'},
    write_project: {key: 'WRITE', id: '10002', name: 'Write project'},
    issue: {key: 'READ-1', id: '10010', summary: 'Example issue'},
    comment: {id: '10000', body: 'A fixture comment'},
    user: {account_id: 'account-1', display_name: 'Fixture User'},
  };

  it('seeds the projects, the issue, its comment, and the user with the ids of the fixtures', async () => {
    const fake = await arrange();

    await fake.seed(fixtures);

    expect(fake.access.accessToken).toBe('jira-access-token-unique');
    expect((await get({fake, path: '/project/WRITE'})).body).toEqual({
      id: '10002',
      key: 'WRITE',
      name: 'Write project',
    });
    expect((await get({fake, path: '/issue/READ-1'})).body).toMatchObject({
      id: '10010',
      key: 'READ-1',
      fields: {summary: 'Example issue'},
    });
    expect((await get({fake, path: '/issue/READ-1/comment'})).body).toMatchObject({
      total: 1,
      comments: [{id: '10000'}],
    });
    expect((await get({fake, path: '/user?accountId=account-1'})).body).toEqual({
      accountId: 'account-1',
      displayName: 'Fixture User',
    });
  });

  it('answers an issue it was not seeded with like Jira does', async () => {
    const fake = await arrange();

    await fake.seed({});

    expect((await get({fake, path: '/issue/READ-1'})).status).toBe(404);
  });

  it('rejects a comment without an issue, and a project without a key', async () => {
    const fake = await arrange();

    await expect(fake.seed({comment: {id: '10000', body: 'A fixture comment'}})).rejects.toThrow(
      'comment fixture needs an issue fixture',
    );
    await expect(fake.seed({read_project: {id: '1', name: 'Read'}})).rejects.toThrow(
      'jira fixture "read_project" has no "key"',
    );
  });

  it('records no writes before a case runs', async () => {
    const fake = await arrange();

    await fake.seed(fixtures);

    expect(fake.writes()).toEqual([]);
  });

  it('is the adapter of the jira provider', () => {
    expect(CONTRACT_FAKE_ADAPTERS.jira).toBe(jiraContractFake);
  });
});
