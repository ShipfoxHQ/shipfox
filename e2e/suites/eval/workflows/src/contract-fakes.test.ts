import type {createApiClient} from '@shipfox/e2e-core';
import {type DiscordApiMock, startDiscordApiMock} from '@shipfox/e2e-driver-discord';
import {type GithubApiMock, startGithubApiMock} from '@shipfox/e2e-driver-github';
import {afterEach, describe, expect, it} from '@shipfox/vitest/vi';
import {
  CONTRACT_FAKE_ADAPTERS,
  type ContractFakeContext,
  clickupContractFake,
  discordContractFake,
  githubContractFake,
  notionContractFake,
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
vi.mock('@shipfox/e2e-setup-integrations', () => ({
  createClickUpConnection: vi.fn(() => Promise.resolve({id: 'connection-2', slug: 'clickup_fake'})),
  createNotionConnection: vi.fn(() => Promise.resolve({id: 'connection-3', slug: 'notion_fake'})),
  createSlackConnection: vi.fn(() => Promise.resolve({id: 'connection-4', slug: 'slack_fake'})),
}));

type ApiClient = ReturnType<typeof createApiClient>;

const token = `ghs_${'a'.repeat(40)}`;
const missingRepositoryPattern = /issue fixture needs a repository fixture/u;
const missingTitlePattern = /fixture "page" has no "title"/u;
const discordNeedsChannelPattern = /need a read_channel fixture/u;
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
