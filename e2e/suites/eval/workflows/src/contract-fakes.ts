import {randomUUID} from 'node:crypto';
import {mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import type {createApiClient, RecordedWrite} from '@shipfox/e2e-core';
import {type ClickUpTaskFixture, startClickUpApiMock} from '@shipfox/e2e-driver-clickup';
import type {GithubApiMock} from '@shipfox/e2e-driver-github';
import {startNotionApiMock} from '@shipfox/e2e-driver-notion';
import {createClickUpConnection, createNotionConnection} from '@shipfox/e2e-setup-integrations';
import type {SandboxManifest} from './contract-schema.js';

/** The `fixtures` of one provider in `sandbox.yaml`. */
export type SandboxFixtures = SandboxManifest[string]['fixtures'];

/** A provider fake that the contracts suite has started, with its connection in the workspace. */
export interface ContractFake {
  /** The slug of the workspace's connection to the fake. */
  connectionSlug: string;
  /**
   * Loads the provider's sandbox fixtures into the fake, with the same ids and fields, so a case
   * reads the same objects from the fake that it reads from the sandbox. A fixture the adapter
   * doesn't know is left out, and the cases that read it fail on the fake.
   */
  seed(fixtures: SandboxFixtures): Promise<void>;
  /** Every write the fake accepted. Read before the fake stops. */
  writes(): RecordedWrite[];
}

/** What every adapter starts from: the workspace of the run, and the GitHub fake of its project. */
export interface ContractFakeContext {
  workspaceId: string;
  uniqueId: string;
  github: {mock: GithubApiMock; connectionId: string; connectionSlug: string};
  /** The API client of the run's user, an admin of the workspace. */
  client: ReturnType<typeof createApiClient>;
  /** Cleanups run in reverse, by the caller, however the run ends. */
  cleanups: Array<() => Promise<void>>;
}

export type ContractFakeAdapter = (context: ContractFakeContext) => Promise<ContractFake>;

function field({
  fixture,
  name,
}: {
  fixture: SandboxFixtures[string];
  name: string;
}): string | number | boolean | undefined {
  const value = fixture[name];
  return typeof value === 'object' ? undefined : value;
}

function requiredField({
  provider = 'github',
  fixture,
  fixtureName,
  name,
}: {
  provider?: string;
  fixture: SandboxFixtures[string];
  fixtureName: string;
  name: string;
}) {
  const value = field({fixture, name});
  if (value === undefined) {
    throw new Error(`The ${provider} fixture "${fixtureName}" has no "${name}".`);
  }
  return value;
}

/** Runs a seeding that needs no await, and fails the returned promise instead of throwing. */
function rejectingSeed(seed: () => void): Promise<void> {
  return new Promise((resolve) => {
    seed();
    resolve();
  });
}

/** Comments for a fixture whose sandbox object holds `count` of them. */
function fixtureComments(fixture: SandboxFixtures[string]): Array<{id: string; text: string}> {
  const count = Number(field({fixture, name: 'comment_count'}) ?? 0);
  return Array.from({length: count}, (_, index) => ({
    id: `contract-comment-${index + 1}`,
    text: `Contract comment ${index + 1}`,
  }));
}

/**
 * GitHub, whose fake the run already started for the project. It seeds the `repository` fixture as
 * a repository of the fake, and the `issue` fixture as one of its issues.
 *
 * The sandbox repository is not the project's repository, and a connection only reaches the
 * repositories of its projects until it is set to reach all of them. The sandbox connection is
 * installed on the whole sandbox organization, so the fake's connection reaches all too.
 */
export const githubContractFake: ContractFakeAdapter = ({github, client, cleanups}) => {
  const {mock} = github;
  return Promise.resolve({
    connectionSlug: github.connectionSlug,
    seed: async (fixtures) => {
      const repository = fixtures.repository;
      if (repository === undefined) {
        if (fixtures.issue !== undefined) {
          throw new Error('The github issue fixture needs a repository fixture.');
        }
        return;
      }
      const owner = String(
        requiredField({fixture: repository, fixtureName: 'repository', name: 'owner'}),
      );
      const name = String(
        requiredField({fixture: repository, fixtureName: 'repository', name: 'name'}),
      );
      const seedDirectory = await mkdtemp(join(tmpdir(), 'contracts-repository-'));
      cleanups.push(() => rm(seedDirectory, {recursive: true, force: true}));
      await writeFile(join(seedDirectory, 'README.md'), '# Contracts sandbox\n');
      const added = await mock.addRepository({owner, name, seedDirectory});
      await client.request(
        'put',
        `/integration-connections/${github.connectionId}/repository-access`,
        {
          json: {mode: 'all'},
        },
      );

      const issue = fixtures.issue;
      if (issue === undefined) return;
      const number = Number(requiredField({fixture: issue, fixtureName: 'issue', name: 'number'}));
      const title = field({fixture: issue, name: 'title'});
      const body = field({fixture: issue, name: 'body'});
      const state = field({fixture: issue, name: 'state'});
      mock.issues.set(number, {
        repository: added.fullName,
        title: title === undefined ? `Contract fixture issue ${number}` : String(title),
        ...(body === undefined ? {} : {body: String(body)}),
        ...(state === 'open' || state === 'closed' ? {state} : {}),
      });
    },
    writes: () => mock.writes(),
  });
};

// What the sandbox's ClickUp tasks are besides tasks of the read list.
const CLICKUP_TASK_FIXTURES = ['task', 'parent_task', 'subtask', 'closed_task'] as const;
const CLICKUP_PARENT_FIXTURE = 'parent_task';
const CLICKUP_SUBTASK_FIXTURE = 'subtask';
const CLICKUP_CLOSED_FIXTURE = 'closed_task';

type ClickUpList = NonNullable<ClickUpTaskFixture['list']>;

function clickupList(fixtures: SandboxFixtures): ClickUpList | undefined {
  const fixture = fixtures.list;
  if (fixture === undefined) return undefined;
  return {
    id: String(requiredField({provider: 'clickup', fixture, fixtureName: 'list', name: 'id'})),
    name: String(field({fixture, name: 'name'}) ?? 'Contracts'),
  };
}

function clickupTask({
  id,
  name,
  list,
  ...rest
}: {id: string; name: string; list: ClickUpList | undefined} & Partial<ClickUpTaskFixture>) {
  return {
    url: `https://app.clickup.com/t/${id}`,
    markdownDescription: '',
    ...rest,
    id,
    name,
    list,
  } satisfies ClickUpTaskFixture;
}

function clickupTasks({
  fixtures,
  list,
}: {
  fixtures: SandboxFixtures;
  list: ClickUpList | undefined;
}): ClickUpTaskFixture[] {
  const parent = fixtures[CLICKUP_PARENT_FIXTURE];
  const parentId = parent === undefined ? undefined : String(field({fixture: parent, name: 'id'}));
  return CLICKUP_TASK_FIXTURES.flatMap((fixtureName) => {
    const fixture = fixtures[fixtureName];
    if (fixture === undefined) return [];
    return [
      clickupTask({
        id: String(requiredField({provider: 'clickup', fixture, fixtureName, name: 'id'})),
        name: String(requiredField({provider: 'clickup', fixture, fixtureName, name: 'name'})),
        list,
        markdownDescription: String(field({fixture, name: 'description'}) ?? ''),
        closed: fixtureName === CLICKUP_CLOSED_FIXTURE,
        parentId: fixtureName === CLICKUP_SUBTASK_FIXTURE ? parentId : undefined,
        comments: fixtureComments(fixture),
      }),
    ];
  });
}

/**
 * ClickUp, with its own fake and a connection to it. It seeds the `list` fixture as a List, the
 * task fixtures as its tasks, and enough more tasks to fill the `task_count` the sandbox list
 * holds, so a task search has a second page. The `task` fixture gets its `comment_count` comments.
 */
export const clickupContractFake: ContractFakeAdapter = async ({
  workspaceId,
  uniqueId,
  cleanups,
}) => {
  const accessToken = `clickup-access-token-${uniqueId}`;
  const mock = await startClickUpApiMock({accessToken});
  cleanups.push(() => mock.stop());
  const connection = await createClickUpConnection({
    workspaceId,
    teamId: `contracts-team-${uniqueId}`,
    teamName: `Contracts ClickUp ${uniqueId}`,
    authorizingUserId: `contracts-user-${uniqueId}`,
    accessToken,
    webhookId: `contracts-webhook-${uniqueId}`,
    webhookSecret: `contracts-secret-${uniqueId}`,
    displayName: `Contracts ClickUp ${uniqueId}`,
  });

  return {
    connectionSlug: connection.slug,
    seed: (fixtures) =>
      rejectingSeed(() => {
        const list = clickupList(fixtures);
        for (const task of clickupTasks({fixtures, list})) mock.tasks.set(task.id, task);
        const taskCount = Number(field({fixture: fixtures.list ?? {}, name: 'task_count'}) ?? 0);
        if (list === undefined) return;
        for (let index = mock.tasks.size; index < taskCount; index++) {
          const id = `contract-filler-${index}`;
          mock.tasks.set(id, clickupTask({id, name: `Contract filler task ${index}`, list}));
        }
      }),
    writes: () => mock.writes(),
  };
};

// What the sandbox's Notion pages are, among its fixtures. A fixture with an `id` and a `title`
// that is not listed here is not a page.
const NOTION_PAGE_FIXTURES = ['page', 'write_parent_page'] as const;

/**
 * Notion, with its own fake and a connection to it. It seeds the page fixtures as pages, and the
 * `page` fixture gets its `comment_count` comments.
 */
export const notionContractFake: ContractFakeAdapter = async ({
  workspaceId,
  uniqueId,
  cleanups,
}) => {
  const accessToken = `notion-access-token-${uniqueId}`;
  const mock = await startNotionApiMock({accessToken});
  cleanups.push(() => mock.stop());
  const connection = await createNotionConnection({
    workspaceId,
    notionWorkspaceId: randomUUID(),
    workspaceName: `Contracts Notion ${uniqueId}`,
    botId: randomUUID(),
    authorizedByUserId: randomUUID(),
    accessToken,
    displayName: `Contracts Notion ${uniqueId}`,
  });

  return {
    connectionSlug: connection.slug,
    seed: (fixtures) =>
      rejectingSeed(() => {
        for (const fixtureName of NOTION_PAGE_FIXTURES) {
          const fixture = fixtures[fixtureName];
          if (fixture === undefined) continue;
          const id = String(requiredField({provider: 'notion', fixture, fixtureName, name: 'id'}));
          const title = String(
            requiredField({provider: 'notion', fixture, fixtureName, name: 'title'}),
          );
          mock.pages.set(id, {
            id,
            title,
            markdown: String(field({fixture, name: 'markdown'}) ?? `# ${title}\n`),
            comments: fixtureComments(fixture),
          });
        }
      }),
    writes: () => mock.writes(),
  };
};

/**
 * The adapter of each provider the suite can run in fake mode. A provider joins when its fake
 * parity unit adds its adapter, and its cases gain `fake` in `modes` in the same change.
 */
export const CONTRACT_FAKE_ADAPTERS: Readonly<Record<string, ContractFakeAdapter>> = {
  github: githubContractFake,
  clickup: clickupContractFake,
  notion: notionContractFake,
};
