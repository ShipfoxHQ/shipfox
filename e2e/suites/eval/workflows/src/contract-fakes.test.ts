import type {createApiClient} from '@shipfox/e2e-core';
import {type DiscordApiMock, startDiscordApiMock} from '@shipfox/e2e-driver-discord';
import {type GithubApiMock, startGithubApiMock} from '@shipfox/e2e-driver-github';
import {type JiraApiMock, startJiraApiMock} from '@shipfox/e2e-driver-jira';
import {createPosthogConnection} from '@shipfox/e2e-setup-integrations';
import {afterEach, describe, expect, it} from '@shipfox/vitest/vi';
import {
  CONTRACT_FAKE_ADAPTERS,
  type ContractFakeContext,
  clickupContractFake,
  createJiraContractFake,
  discordContractFake,
  githubContractFake,
  jiraContractFake,
  notionContractFake,
  posthogContractFake,
  type SandboxFixtures,
  seedDiscord,
} from './contract-fakes.js';

// The fakes listen behind the stack's router in a run. The tests bind them to a free port, and
// keep them to read what the adapters seeded.
const started: {clickup?: {endpoint: URL}; notion?: {endpoint: URL}} = {};
vi.mock('@shipfox/e2e-driver-clickup', async (importOriginal) => {
  const original = await importOriginal<typeof import('@shipfox/e2e-driver-clickup')>();
  return {
    ...original,
    startClickUpApiMock: async (options: Parameters<typeof original.startClickUpApiMock>[0]) => {
      const mock = await original.startClickUpApiMock({
        ...options,
        endpoint: new URL('http://127.0.0.1:0'),
      });
      started.clickup = mock;
      return mock;
    },
  };
});
vi.mock('@shipfox/e2e-driver-notion', async (importOriginal) => {
  const original = await importOriginal<typeof import('@shipfox/e2e-driver-notion')>();
  return {
    ...original,
    startNotionApiMock: async (options: Parameters<typeof original.startNotionApiMock>[0]) => {
      const mock = await original.startNotionApiMock({
        ...options,
        endpoint: new URL('http://127.0.0.1:0'),
      });
      started.notion = mock;
      return mock;
    },
  };
});
const {seedPosthogMock} = vi.hoisted(() => ({seedPosthogMock: vi.fn()}));
vi.mock('@shipfox/e2e-driver-posthog', () => ({seedPosthogMock}));
vi.mock('@shipfox/e2e-setup-integrations', () => ({
  createPosthogConnection: vi.fn(() => Promise.resolve({id: 'connection-5', slug: 'posthog_fake'})),
  createClickUpConnection: vi.fn(() => Promise.resolve({id: 'connection-2', slug: 'clickup_fake'})),
  createNotionConnection: vi.fn(() => Promise.resolve({id: 'connection-3', slug: 'notion_fake'})),
  createSlackConnection: vi.fn(() => Promise.resolve({id: 'connection-4', slug: 'slack_fake'})),
}));

type ApiClient = ReturnType<typeof createApiClient>;

const token = `ghs_${'a'.repeat(40)}`;
const missingRepositoryPattern = /issue fixture needs a repository fixture/u;
const missingTitlePattern = /fixture "page" has no "title"/u;
const discordNeedsChannelPattern = /need a read_channel fixture/u;
const missingCountPattern = /posthog fixture "event" has no "count"/u;
const missingOwnerPattern = /fixture "repository" has no "owner"/u;

describe('githubContractFake', () => {
  let mock: GithubApiMock | undefined;
  const cleanups: Array<() => Promise<void>> = [];
  const requests: Array<{method: string; path: string; options: unknown}> = [];

  afterEach(async () => {
    requests.length = 0;
    for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
    await mock?.stop();
    mock = undefined;
  });

  async function arrange() {
    mock = await startGithubApiMock({
      endpoint: new URL('http://127.0.0.1:0'),
      installationToken: token,
    });
    return await githubContractFake({
      workspaceId: 'workspace',
      uniqueId: 'unique',
      github: {mock, connectionId: 'connection-1', connectionSlug: 'github_fake'},
      client: {
        request: (method: string, path: string, options: unknown) => {
          requests.push({method, path, options});
          return Promise.resolve();
        },
      } as unknown as ApiClient,
      cleanups,
    });
  }

  async function readIssue(number: number) {
    const response = await fetch(
      new URL(`/repos/contracts-sandbox/fixtures/issues/${number}`, mock?.endpoint),
      {headers: {authorization: `token ${token}`}},
    );
    return {status: response.status, body: (await response.json()) as Record<string, unknown>};
  }

  it('serves the fixture issue from the fixture repository, with the same number and fields', async () => {
    const fake = await arrange();
    const fixtures: SandboxFixtures = {
      repository: {owner: 'contracts-sandbox', name: 'fixtures'},
      issue: {number: 7, title: 'Read fixture', body: 'Body', state: 'closed'},
    };

    await fake.seed(fixtures);

    expect(fake.connectionSlug).toBe('github_fake');
    // The sandbox repository is not the project's, so the connection has to reach all repositories.
    expect(requests).toEqual([
      {
        method: 'put',
        path: '/integration-connections/connection-1/repository-access',
        options: {json: {mode: 'all'}},
      },
    ]);
    expect(await readIssue(7)).toMatchObject({
      status: 200,
      body: {number: 7, title: 'Read fixture', body: 'Body', state: 'closed'},
    });
  });

  it('seeds only the issues the sandbox has', async () => {
    const fake = await arrange();

    await fake.seed({repository: {owner: 'contracts-sandbox', name: 'fixtures'}});

    expect(mock?.issues.size).toBe(0);
  });

  it('seeds nothing for a manifest without GitHub fixtures', async () => {
    const fake = await arrange();

    await fake.seed({});

    expect(mock?.issues.size).toBe(0);
  });

  it('rejects an issue without a repository, and a repository without an owner', async () => {
    const fake = await arrange();

    await expect(fake.seed({issue: {number: 1}})).rejects.toThrow(missingRepositoryPattern);
    await expect(fake.seed({repository: {name: 'fixtures'}})).rejects.toThrow(missingOwnerPattern);
  });

  it('is the adapter of the github provider', () => {
    expect(CONTRACT_FAKE_ADAPTERS.github).toBe(githubContractFake);
  });
});

describe('clickupContractFake and notionContractFake', () => {
  const cleanups: Array<() => Promise<void>> = [];

  afterEach(async () => {
    for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  });

  const context = (): ContractFakeContext =>
    ({workspaceId: 'workspace', uniqueId: 'unique', cleanups}) as unknown as ContractFakeContext;

  const clickupFixtures: SandboxFixtures = {
    list: {id: 'list-1', name: 'Contracts read', task_count: 104},
    task: {id: 'task-1', name: 'Fixture task', comment_count: 32},
    parent_task: {id: 'task-2', name: 'Parent'},
    subtask: {id: 'task-3', name: 'Subtask'},
    closed_task: {id: 'task-4', name: 'Closed'},
  };

  async function getJson({endpoint, path}: {endpoint: URL | undefined; path: string}) {
    return (await (await fetch(new URL(path, endpoint))).json()) as Record<string, unknown>;
  }

  it('seeds ClickUp with the tasks of the fixtures and a list of 104 tasks', async () => {
    const fake = await clickupContractFake(context());

    await fake.seed(clickupFixtures);

    const endpoint = started.clickup?.endpoint;
    const task = await getJson({endpoint, path: '/api/v2/task/task-1'});
    const comments = (await getJson({endpoint, path: '/api/v2/task/task-1/comment'})) as {
      comments: unknown[];
    };
    const first = (await getJson({
      endpoint,
      path: '/api/v2/team/team/task?list_ids[]=list-1&page=0&include_closed=true&subtasks=true',
    })) as {tasks: unknown[]; last_page: boolean};
    const last = (await getJson({
      endpoint,
      path: '/api/v2/team/team/task?list_ids[]=list-1&page=1&include_closed=true&subtasks=true',
    })) as {tasks: unknown[]; last_page: boolean};
    const open = (await getJson({
      endpoint,
      path: '/api/v2/team/team/task?list_ids[]=list-1&page=1',
    })) as {tasks: unknown[]};
    expect(fake.connectionSlug).toBe('clickup_fake');
    expect(task).toMatchObject({id: 'task-1', name: 'Fixture task', list: {id: 'list-1'}});
    expect(comments.comments).toHaveLength(25);
    expect(first.tasks).toHaveLength(100);
    expect(first.last_page).toBe(false);
    expect(last).toMatchObject({last_page: true});
    expect(last.tasks).toHaveLength(4);
    // Without the closed task and the subtask, 102 tasks leave two on the second page.
    expect(open.tasks).toHaveLength(2);
  });

  it('seeds Notion with the page fixtures, their title, content, and comments', async () => {
    const fake = await notionContractFake(context());

    await fake.seed({page: {id: 'page-1', title: 'Fixture page', comment_count: 32}});

    const endpoint = started.notion?.endpoint;
    const page = await getJson({endpoint, path: '/v1/pages/page-1'});
    const content = await getJson({endpoint, path: '/v1/pages/page-1/markdown'});
    const comments = (await getJson({endpoint, path: '/v1/comments?block_id=page-1'})) as {
      results: unknown[];
      has_more: boolean;
    };
    expect(fake.connectionSlug).toBe('notion_fake');
    expect(page).toMatchObject({
      id: 'page-1',
      properties: {title: {title: [{plain_text: 'Fixture page'}]}},
    });
    expect(content).toMatchObject({markdown: '# Fixture page\n', truncated: false});
    expect(comments.results).toHaveLength(32);
    expect(comments.has_more).toBe(false);
  });

  it('rejects a page fixture without a title', async () => {
    const fake = await notionContractFake(context());

    await expect(fake.seed({page: {id: 'page-1'}})).rejects.toThrow(missingTitlePattern);
  });

  it('is the adapter of the clickup and notion providers', () => {
    expect(CONTRACT_FAKE_ADAPTERS.clickup).toBe(clickupContractFake);
    expect(CONTRACT_FAKE_ADAPTERS.notion).toBe(notionContractFake);
  });
});

describe('seedDiscord', () => {
  let discord: DiscordApiMock | undefined;
  const guildId = '2000000000000000001';
  const fixtures: SandboxFixtures = {
    read_channel: {id: '1000000000000000001', name: 'contract-test-read'},
    message: {id: '1000000000000000002', content: 'Contract test read message'},
    thread: {id: '1000000000000000003', name: 'Contract test thread'},
    user: {id: '1000000000000000004', username: 'sandbox_user'},
  };

  afterEach(async () => {
    await discord?.stop();
    discord = undefined;
  });

  async function arrange() {
    discord = await startDiscordApiMock({endpoint: new URL('http://127.0.0.1:0')});
    return discord;
  }

  async function get(path: string) {
    const response = await fetch(new URL(path, discord?.endpoint));
    return {status: response.status, body: (await response.json()) as Record<string, unknown>};
  }

  it('serves the read channel, its thread, and its message with the fixture ids', async () => {
    const mock = await arrange();

    seedDiscord({discord: mock, guildId, fixtures});

    expect((await get('/channels/1000000000000000001')).body).toMatchObject({
      type: 0,
      guild_id: guildId,
      name: 'contract-test-read',
    });
    expect((await get('/channels/1000000000000000003')).body).toMatchObject({
      type: 11,
      guild_id: guildId,
      parent_id: '1000000000000000001',
      name: 'Contract test thread',
    });
    expect(
      (await get('/channels/1000000000000000001/messages/1000000000000000002')).body,
    ).toMatchObject({
      content: 'Contract test read message',
      author: {id: '1000000000000000004', username: 'sandbox_user'},
    });
  });

  it('seeds nothing for a manifest without Discord fixtures', async () => {
    const mock = await arrange();

    seedDiscord({discord: mock, guildId, fixtures: {}});

    expect((await get('/channels/1000000000000000001')).status).toBe(404);
  });

  it('rejects a message or a thread without a read channel', async () => {
    const mock = await arrange();

    expect(() =>
      seedDiscord({discord: mock, guildId, fixtures: {message: fixtures.message ?? {}}}),
    ).toThrow(discordNeedsChannelPattern);
    expect(() =>
      seedDiscord({discord: mock, guildId, fixtures: {thread: fixtures.thread ?? {}}}),
    ).toThrow(discordNeedsChannelPattern);
  });

  it('is the adapter of the discord provider', () => {
    expect(CONTRACT_FAKE_ADAPTERS.discord).toBe(discordContractFake);
  });
});

describe('posthogContractFake', () => {
  async function arrange() {
    vi.clearAllMocks();
    return await posthogContractFake({
      workspaceId: 'workspace',
      uniqueId: 'unique',
      github: {
        mock: {} as GithubApiMock,
        connectionId: 'connection-1',
        connectionSlug: 'github_fake',
      },
      client: {} as ApiClient,
      cleanups: [],
    });
  }

  it('connects the workspace with a key of its own, and seeds that key', async () => {
    const fake = await arrange();

    await fake.seed({
      project: {id: 295166, region: 'eu'},
      event: {name: 'contract_event', count: 40},
      purchase_event: {name: 'contract_purchase', count: 10},
      feature_flag: {id: 301243, key: 'contract-flag'},
      disabled_feature_flag: {id: 301244, key: 'contract-flag-disabled'},
      insight: {id: 6355500},
    });

    expect(fake.connectionSlug).toBe('posthog_fake');
    expect(createPosthogConnection).toHaveBeenCalledWith(
      expect.objectContaining({workspaceId: 'workspace', apiKey: 'phx_contracts_unique'}),
    );
    expect(seedPosthogMock).toHaveBeenCalledWith({
      apiKey: 'phx_contracts_unique',
      seed: {
        events: [
          {name: 'contract_event', count: 40},
          {name: 'contract_purchase', count: 10},
        ],
        feature_flags: [
          {id: 301243, key: 'contract-flag'},
          {id: 301244, key: 'contract-flag-disabled', active: false},
        ],
      },
    });
    expect(fake.writes()).toEqual([]);
  });

  it('seeds only the fixtures the sandbox has, and rejects one without its fields', async () => {
    const fake = await arrange();

    await fake.seed({});
    await expect(fake.seed({event: {name: 'contract_event'}})).rejects.toThrow(missingCountPattern);

    expect(seedPosthogMock).toHaveBeenCalledTimes(1);
    expect(seedPosthogMock).toHaveBeenCalledWith({
      apiKey: 'phx_contracts_unique',
      seed: {events: [], feature_flags: []},
    });
  });

  it('is the adapter of the posthog provider', () => {
    expect(CONTRACT_FAKE_ADAPTERS.posthog).toBe(posthogContractFake);
  });
});

describe('jiraContractFake', () => {
  let mock: JiraApiMock | undefined;

  afterEach(async () => {
    await mock?.stop();
    mock = undefined;
  });

  async function arrange() {
    const started = await startJiraApiMock({endpoint: new URL('http://127.0.0.1:0')});
    mock = started;
    const adapter = createJiraContractFake({
      arrange: () =>
        Promise.resolve({
          connectionSlug: 'jira_fake',
          mock: started,
          sender: () => Promise.reject(new Error('The contracts suite sends no events.')),
          writes: () => [],
        }),
    });
    return await adapter({
      workspaceId: 'workspace',
      uniqueId: 'unique',
      github: {mock: {} as GithubApiMock, connectionId: 'connection-1', connectionSlug: 'github'},
      client: {} as ApiClient,
      cleanups: [],
    });
  }

  async function get(path: string) {
    const response = await fetch(new URL(`/ex/jira/cloud/rest/api/3${path}`, mock?.endpoint));
    return (await response.json()) as Record<string, unknown>;
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

    expect(fake.connectionSlug).toBe('jira_fake');
    expect(await get('/project/WRITE')).toEqual({id: '10002', key: 'WRITE', name: 'Write project'});
    expect(await get('/issue/READ-1')).toMatchObject({
      id: '10010',
      key: 'READ-1',
      fields: {summary: 'Example issue'},
    });
    expect(await get('/issue/READ-1/comment')).toMatchObject({
      total: 1,
      comments: [{id: '10000'}],
    });
    expect(await get('/user?accountId=account-1')).toEqual({
      accountId: 'account-1',
      displayName: 'Fixture User',
    });
  });

  it('seeds nothing for a manifest without Jira fixtures', async () => {
    const fake = await arrange();

    await fake.seed({});

    expect(await get('/issue/READ-1')).toMatchObject({id: '10000', key: 'READ-1'});
  });

  it('rejects a comment without an issue, and a project without a key', async () => {
    const fake = await arrange();

    await expect(fake.seed({comment: fixtures.comment ?? {}})).rejects.toThrow(
      'comment fixture needs an issue fixture',
    );
    await expect(fake.seed({read_project: {id: '1', name: 'Read'}})).rejects.toThrow(
      'jira fixture "read_project" has no "key"',
    );
  });

  it('is the adapter of the jira provider', () => {
    expect(CONTRACT_FAKE_ADAPTERS.jira).toBe(jiraContractFake);
  });
});
