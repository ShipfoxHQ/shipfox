import {createHash, randomUUID} from 'node:crypto';
import {mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import type {createApiClient, RecordedWrite} from '@shipfox/e2e-core';
import {type ClickUpTaskFixture, startClickUpApiMock} from '@shipfox/e2e-driver-clickup';
import {type DiscordApiMock, startDiscordApiMock} from '@shipfox/e2e-driver-discord';
import type {
  GithubApiMock,
  GithubIssueFixture,
  GithubPullRequestFixture,
} from '@shipfox/e2e-driver-github';
import type {JiraSeed} from '@shipfox/e2e-driver-jira';
import {loadLinearRecordings, startLinearMcpMock} from '@shipfox/e2e-driver-linear';
import {startNotionApiMock} from '@shipfox/e2e-driver-notion';
import {seedPosthogMock} from '@shipfox/e2e-driver-posthog';
import {
  type SlackApiMock,
  type SlackChannelSeed,
  startSlackApiMock,
} from '@shipfox/e2e-driver-slack';
import {
  createClickUpConnection,
  createDiscordConnection,
  createLinearConnection,
  createNotionConnection,
  createPosthogConnection,
  createSlackConnection,
} from '@shipfox/e2e-setup-integrations';
import type {SandboxManifest} from './contract-schema.js';
import {discordSnowflake} from './discord-workspace.js';
import {arrangeJiraTracker} from './jira.js';

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

// What the sandbox's GitHub issues and pull requests are, among its fixtures. An issue fixture
// holds an `open` issue unless its name says it is closed, and a pull request fixture holds an
// open pull request unless its name says closed or merged.
const GITHUB_ISSUE_FIXTURES = ['issue', 'closed_issue', 'parent_issue', 'sub_issue'] as const;
const GITHUB_PULL_REQUEST_FIXTURES = [
  'pull_request',
  'closed_pull_request',
  'merged_pull_request',
] as const;

const GITHUB_PARENT_FIXTURE = 'parent_issue';
const GITHUB_SUB_ISSUE_FIXTURE = 'sub_issue';
const GITHUB_SANDBOX_AUTHOR = 'e2e-author';
const GITHUB_SANDBOX_REVIEWER = 'e2e-reviewer';
// The checks the sandbox workflow reports on the head of the open pull request: its two jobs.
const GITHUB_OPEN_PULL_REQUEST_CHECK_RUNS = [{name: 'build'}, {name: 'verify'}];

// What the sandbox's open pull request changes, which the pull request read cases assert on.
const GITHUB_OPEN_PULL_REQUEST_FILES = [
  {
    filename: 'fixtures/notes.md',
    status: 'modified',
    patch: '@@ -1,3 +1,4 @@\n # Notes\n \n-Three notes.\n+Four notes.\n+Why four?',
  },
  {filename: 'fixtures/extra.txt', status: 'added', patch: '@@ -0,0 +1 @@\n+Extra file.'},
] as const;

function gitSha(seed: string): string {
  return createHash('sha1').update(seed).digest('hex');
}

function seedGithubIssues({
  mock,
  repository,
  fixtures,
}: {
  mock: GithubApiMock;
  repository: string;
  fixtures: SandboxFixtures;
}): void {
  for (const fixtureName of GITHUB_ISSUE_FIXTURES) {
    const fixture = fixtures[fixtureName];
    if (fixture === undefined) continue;
    const number = Number(requiredField({fixture, fixtureName, name: 'number'}));
    mock.issues.set(number, githubIssue({repository, fixtures, fixtureName, fixture}));
  }
}

function githubIssue({
  repository,
  fixtures,
  fixtureName,
  fixture,
}: {
  repository: string;
  fixtures: SandboxFixtures;
  fixtureName: (typeof GITHUB_ISSUE_FIXTURES)[number];
  fixture: SandboxFixtures[string];
}): GithubIssueFixture {
  const number = Number(requiredField({fixture, fixtureName, name: 'number'}));
  const title = field({fixture, name: 'title'});
  const body = field({fixture, name: 'body'});
  const label = field({fixture: fixtures.label ?? {}, name: 'name'});
  const parent =
    fixtureName === GITHUB_SUB_ISSUE_FIXTURE ? fixtures[GITHUB_PARENT_FIXTURE] : undefined;
  const comments = githubIssueComments(fixture);
  return {
    repository,
    title: title === undefined ? `Contract fixture issue ${number}` : String(title),
    ...(body === undefined ? {} : {body: String(body)}),
    ...(fixtureName === 'closed_issue' || field({fixture, name: 'state'}) === 'closed'
      ? {state: 'closed'}
      : {}),
    // The sandbox puts its label on the first fixture issue.
    ...(fixtureName === 'issue' && label !== undefined ? {labels: [String(label)]} : {}),
    ...(parent === undefined
      ? {}
      : {
          parent: Number(
            requiredField({fixture: parent, fixtureName: GITHUB_PARENT_FIXTURE, name: 'number'}),
          ),
        }),
    ...(comments.length === 0 ? {} : {comments}),
  };
}

// The sandbox comments carry non-ASCII text from the first one, so a read proves the encoding.
function githubIssueComments(fixture: SandboxFixtures[string]) {
  const count = Number(field({fixture, name: 'comment_count'}) ?? 0);
  return Array.from({length: count}, (_, index) => ({
    id: index + 1,
    body: `Comment ${index + 1}: café 日本語`,
    author: GITHUB_SANDBOX_AUTHOR,
  }));
}

// The branch and the commit fixtures. The sandbox pins their ids, so the fake reports those ids
// and not the ones a git repository would give. The commit sits on top of its base commit.
function seedGithubCommits({
  mock,
  repository,
  fixtures,
}: {
  mock: GithubApiMock;
  repository: string;
  fixtures: SandboxFixtures;
}): void {
  const {commit, branch} = fixtures;
  if (commit !== undefined) {
    const oid = String(requiredField({fixture: commit, fixtureName: 'commit', name: 'oid'}));
    const baseOid = field({fixture: commit, name: 'base_oid'});
    if (baseOid !== undefined) {
      mock.commits.set(String(baseOid), {repository, message: 'Seed the fixture repository'});
    }
    mock.commits.set(oid, {
      repository,
      message: String(field({fixture: commit, name: 'message'}) ?? `Commit ${oid}`),
      ...(baseOid === undefined ? {} : {parents: [String(baseOid)]}),
    });
  }
  if (branch !== undefined) {
    const name = String(requiredField({fixture: branch, fixtureName: 'branch', name: 'name'}));
    const oid = String(requiredField({fixture: branch, fixtureName: 'branch', name: 'oid'}));
    if (!mock.commits.has(oid)) mock.commits.set(oid, {repository, message: `Tip of ${name}`});
    mock.branchHeads.set(name, oid);
  }
}

// The review of the sandbox's open pull request: a plain comment, a review with two threads (one
// answered, one resolved), and the check runs of its head commit.
function seedGithubOpenPullRequest({
  mock,
  number,
  pullRequest,
}: {
  mock: GithubApiMock;
  number: number;
  pullRequest: GithubPullRequestFixture;
}): void {
  const head = mock.commits.get(pullRequest.sha);
  if (head !== undefined) {
    head.checkRuns = [...GITHUB_OPEN_PULL_REQUEST_CHECK_RUNS];
    pullRequest.commits = [pullRequest.sha];
  }
  pullRequest.files = GITHUB_OPEN_PULL_REQUEST_FILES.map((file) => ({...file}));
  pullRequest.comments = [
    {id: 9001, body: 'A plain pull request comment.', author: GITHUB_SANDBOX_AUTHOR},
  ];
  pullRequest.reviews = [{id: 8001, body: 'Review with threads.', author: GITHUB_SANDBOX_REVIEWER}];
  const path = GITHUB_OPEN_PULL_REQUEST_FILES[0].filename;
  mock.reviewThreads.set(`PRRT_contract_${number}_1`, {
    pullNumber: number,
    path,
    comments: [
      {id: 7001, body: 'First thread: why four?', author: GITHUB_SANDBOX_REVIEWER},
      {id: 7002, body: 'Because four reads better.', author: GITHUB_SANDBOX_AUTHOR},
    ],
  });
  mock.reviewThreads.set(`PRRT_contract_${number}_2`, {
    pullNumber: number,
    path,
    isResolved: true,
    comments: [{id: 7003, body: 'Second thread: a typo.', author: GITHUB_SANDBOX_REVIEWER}],
  });
}

function seedGithubPullRequests({
  mock,
  repository,
  fixtures,
}: {
  mock: GithubApiMock;
  repository: string;
  fixtures: SandboxFixtures;
}): void {
  for (const fixtureName of GITHUB_PULL_REQUEST_FIXTURES) {
    const fixture = fixtures[fixtureName];
    if (fixture === undefined) continue;
    const number = Number(requiredField({fixture, fixtureName, name: 'number'}));
    const ref = String(field({fixture, name: 'head_ref'}) ?? `contract/pull-request-${number}`);
    const pullRequest: GithubPullRequestFixture = {
      repository,
      ref,
      // A branch the sandbox pins reports its pinned tip, which the status and checks read.
      sha: mock.branchHeads.get(ref) ?? gitSha(`${repository}#${number}`),
      title: String(requiredField({fixture, fixtureName, name: 'title'})),
      state: fixtureName === 'pull_request' ? 'open' : 'closed',
      merged: fixtureName === 'merged_pull_request',
    };
    mock.pullRequests.set(number, pullRequest);
    if (fixtureName === 'pull_request') seedGithubOpenPullRequest({mock, number, pullRequest});
  }
}

const GITHUB_FIRST_RUN_ID = 25_000_000_000;

function seedGithubWorkflow({
  mock,
  repository,
  workflow,
}: {
  mock: GithubApiMock;
  repository: string;
  workflow: SandboxFixtures[string];
}): void {
  const required = (name: string) =>
    requiredField({fixture: workflow, fixtureName: 'workflow', name});
  const id = Number(required('id'));
  mock.workflows.set(id, {
    repository,
    name: String(required('name')),
    file: String(required('file')),
  });
  // Runs expire in the sandbox, and the cases read the second newest completed one, because the
  // newest may still be running. Each run has the jobs and the artifact the sandbox workflow makes.
  for (const offset of [1, 2]) {
    mock.workflowRuns.set(GITHUB_FIRST_RUN_ID + offset, {
      workflowId: id,
      sha: gitSha(`${repository}@${id}`),
      jobs: [
        {name: 'build', steps: ['Set up job', 'Run actions/checkout', 'Build', 'Complete job']},
        {name: 'verify', steps: ['Set up job', 'Verify', 'Complete job'], logs: 'Verified\n'},
      ],
      artifacts: [{name: 'report', sizeInBytes: 2048}],
    });
  }
}

// The sandbox's trigger workflow runs only when a case dispatches it. Its run is titled with the
// `marker` input, and its `outcome` input picks whether the run fails at once or keeps running.
function seedGithubTriggerWorkflow({
  mock,
  repository,
  workflow,
}: {
  mock: GithubApiMock;
  repository: string;
  workflow: SandboxFixtures[string];
}): void {
  const required = (name: string) =>
    requiredField({fixture: workflow, fixtureName: 'trigger_workflow', name});
  mock.workflows.set(Number(required('id')), {
    repository,
    name: String(required('name')),
    file: String(required('file')),
    runName: `${String(required('name'))} \${{ inputs.marker }}`,
    outcomeInput: 'outcome',
  });
}

/**
 * GitHub, whose fake the run already started for the project. It seeds the `repository` fixture as
 * a repository of the fake, the issue fixtures as its issues, the pull request fixtures as its pull
 * requests, the `branch` and `commit` fixtures as a branch tip and its commit, and the `workflow`
 * fixture as a workflow with two completed runs, and the `trigger_workflow` fixture as a workflow
 * with none, which a dispatch starts. The `label` fixture goes on the `issue` fixture,
 * the `issue` fixture gets its `comment_count` comments, and `sub_issue` is a sub-issue of
 * `parent_issue`. The open pull request gets the files, review, and check runs the sandbox holds.
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
        const orphan = [
          ...GITHUB_ISSUE_FIXTURES,
          ...GITHUB_PULL_REQUEST_FIXTURES,
          'branch',
          'commit',
          'workflow',
          'trigger_workflow',
        ].find((fixtureName) => fixtures[fixtureName] !== undefined);
        if (orphan !== undefined) {
          throw new Error(`The github ${orphan} fixture needs a repository fixture.`);
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
      seedGithubIssues({mock, repository: added.fullName, fixtures});
      seedGithubCommits({mock, repository: added.fullName, fixtures});
      seedGithubPullRequests({mock, repository: added.fullName, fixtures});
      if (fixtures.workflow !== undefined) {
        seedGithubWorkflow({mock, repository: added.fullName, workflow: fixtures.workflow});
      }
      if (fixtures.trigger_workflow !== undefined) {
        seedGithubTriggerWorkflow({
          mock,
          repository: added.fullName,
          workflow: fixtures.trigger_workflow,
        });
      }
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
 * `page` fixture gets its `comment_count` comments. The `data_source` fixture becomes a data
 * source of `row_count` rows, so a query has a second page.
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
        const dataSource = fixtures.data_source;
        if (dataSource === undefined) return;
        const id = String(
          requiredField({
            provider: 'notion',
            fixture: dataSource,
            fixtureName: 'data_source',
            name: 'id',
          }),
        );
        const rowCount = Number(field({fixture: dataSource, name: 'row_count'}) ?? 0);
        mock.dataSources.set(id, {
          id,
          rows: Array.from({length: rowCount}, (_, index) => ({
            id: `contract-row-${index + 1}`,
            title: `Contract row ${index + 1}`,
          })),
        });
      }),
    writes: () => mock.writes(),
  };
};

// Discord's channel types: a text channel and a public thread.
const TEXT_CHANNEL = 0;
const PUBLIC_THREAD = 11;

/** Loads the fixtures the Discord cases read into the fake, under the connection's server. */
export function seedDiscord({
  discord,
  guildId,
  fixtures,
}: {
  discord: DiscordApiMock;
  guildId: string;
  fixtures: SandboxFixtures;
}): void {
  const {read_channel: channel, write_channel: writeChannel, thread, message, user} = fixtures;
  if (channel === undefined && (message !== undefined || thread !== undefined)) {
    throw new Error('The discord message and thread fixtures need a read_channel fixture.');
  }
  if (writeChannel !== undefined) {
    discord.addChannel({
      id: String(
        requiredField({
          provider: 'discord',
          fixture: writeChannel,
          fixtureName: 'write_channel',
          name: 'id',
        }),
      ),
      type: TEXT_CHANNEL,
      guild_id: guildId,
      name: String(field({fixture: writeChannel, name: 'name'}) ?? 'contract-test-write'),
    });
  }
  const author =
    user === undefined
      ? {id: '1', username: 'user'}
      : {
          id: String(
            requiredField({provider: 'discord', fixture: user, fixtureName: 'user', name: 'id'}),
          ),
          username: String(field({fixture: user, name: 'username'}) ?? 'user'),
        };
  if (user !== undefined) discord.addMember({guildId, member: {user: author}});
  if (channel === undefined) return;
  const channelId = String(
    requiredField({provider: 'discord', fixture: channel, fixtureName: 'read_channel', name: 'id'}),
  );
  discord.addChannel({
    id: channelId,
    type: TEXT_CHANNEL,
    guild_id: guildId,
    name: String(field({fixture: channel, name: 'name'}) ?? 'contract-test-read'),
  });
  if (thread !== undefined) {
    discord.addChannel({
      id: String(
        requiredField({provider: 'discord', fixture: thread, fixtureName: 'thread', name: 'id'}),
      ),
      type: PUBLIC_THREAD,
      guild_id: guildId,
      parent_id: channelId,
      name: String(field({fixture: thread, name: 'name'}) ?? 'Contract test thread'),
    });
  }
  if (message !== undefined) {
    discord.addMessage({
      id: String(
        requiredField({provider: 'discord', fixture: message, fixtureName: 'message', name: 'id'}),
      ),
      channel_id: channelId,
      content: String(field({fixture: message, name: 'content'}) ?? ''),
      author,
    });
  }
}

/**
 * Discord. The suite starts its fake here and connects it to the workspace. It seeds the
 * `read_channel` and `write_channel` fixtures as text channels, the `thread` fixture as a thread in
 * the read channel, the `message` fixture as a message of the read channel, and the `user` fixture
 * as a member of the server.
 *
 * The connection takes a server ID of its own. The sandbox server's ID can connect to one
 * workspace per Shipfox instance, so a second run against the same API would fail with a conflict.
 * The server ID only shows in the `url` of a result, which no case pins.
 */
export const discordContractFake: ContractFakeAdapter = async ({workspaceId, cleanups}) => {
  const discord = await startDiscordApiMock();
  cleanups.push(() => discord.stop());
  const guildId = discordSnowflake();
  const connection = await createDiscordConnection({
    workspaceId,
    guildId,
    guildName: 'Contracts sandbox',
  });

  return {
    connectionSlug: connection.slug,
    seed: (fixtures) => rejectingSeed(() => seedDiscord({discord, guildId, fixtures})),
    writes: () => discord.writes(),
  };
};

// The sandbox read channel holds about 20 messages, so a case that passes a small `limit` gets a
// cursor. The fixtures name only the messages cases read, and the rest fill the channel.
const SLACK_READ_CHANNEL_MESSAGES = 20;
const SLACK_FILLER_BASE_TS = 1_791_220_000;

function slackField({
  fixtures,
  fixtureName,
  name,
}: {
  fixtures: SandboxFixtures;
  fixtureName: string;
  name: string;
}): string {
  const fixture = fixtures[fixtureName];
  if (fixture === undefined) throw new Error(`The slack manifest has no "${fixtureName}" fixture.`);
  return String(requiredField({provider: 'slack', fixture, fixtureName, name}));
}

interface SlackSeeds {
  user?: {id: string} & Record<string, unknown>;
  channels: SlackChannelSeed[];
  thread?: {channel: string; ts: string; messages: Record<string, unknown>[]};
}

/** What the Slack fake serves for the sandbox fixtures, with `botUserId` as a member of each channel. */
function slackSeeds({
  fixtures,
  botUserId,
  teamId,
}: {
  fixtures: SandboxFixtures;
  botUserId: string;
  teamId: string;
}): SlackSeeds {
  const field = (fixtureName: string, name: string) => slackField({fixtures, fixtureName, name});
  const userId = fixtures.user === undefined ? undefined : field('user', 'id');
  const members = userId === undefined ? [botUserId] : [userId, botUserId];
  const seeds: SlackSeeds = {channels: []};
  if (userId !== undefined) {
    seeds.user = {
      id: userId,
      team_id: teamId,
      name: 'contract-user',
      real_name: 'Contract User',
      deleted: false,
      is_bot: false,
      profile: {real_name: 'Contract User', display_name: 'contract-user'},
    };
  }
  if (fixtures.write_channel !== undefined) {
    seeds.channels.push({
      id: field('write_channel', 'id'),
      name: field('write_channel', 'name'),
      members,
    });
  }
  if (fixtures.read_channel === undefined) return seeds;

  const channelId = field('read_channel', 'id');
  const message = ({text, ts}: {text: string; ts: string}) => ({
    type: 'message',
    user: userId ?? botUserId,
    text,
    ts,
    team: teamId,
  });
  const messages: Record<string, unknown>[] = [];
  if (fixtures.thread !== undefined) {
    const ts = field('thread', 'ts');
    messages.push({
      ...message({text: field('thread', 'text'), ts}),
      thread_ts: ts,
      reply_count: 2,
      reply_users: members.slice(0, 1),
      reply_users_count: 1,
    });
    const reply = ({text, replyTs}: {text: string; replyTs: string}) => ({
      ...message({text, ts: replyTs}),
      thread_ts: ts,
    });
    seeds.thread = {
      channel: channelId,
      ts,
      messages: [
        ...messages,
        reply({text: 'Contract fixture reply 1', replyTs: field('thread', 'reply_ts')}),
        reply({text: 'Contract fixture reply 2', replyTs: field('thread', 'last_reply_ts')}),
      ],
    };
  }
  if (fixtures.reaction_message !== undefined) {
    messages.push({
      ...message({
        text: 'Contract fixture message with a reaction',
        ts: field('reaction_message', 'ts'),
      }),
      reactions: [{name: 'white_check_mark', count: 1, users: members.slice(0, 1)}],
    });
  }
  if (fixtures.unicode_message !== undefined) {
    messages.push(
      message({
        text: 'Contract fixture message: café, 日本語, 🎉',
        ts: field('unicode_message', 'ts'),
      }),
    );
  }
  for (let index = messages.length; index < SLACK_READ_CHANNEL_MESSAGES; index += 1) {
    messages.push(
      message({
        text: `Contract fixture message ${index + 1}`,
        ts: `${SLACK_FILLER_BASE_TS + index}.000100`,
      }),
    );
  }
  seeds.channels.push({
    id: channelId,
    name: field('read_channel', 'name'),
    members,
    messages,
  });
  return seeds;
}

/**
 * Slack, behind a bot token the fake answers for. It seeds the `read_channel` and `write_channel`
 * fixtures as channels, with the `user` fixture and the bot as their members. The read channel
 * holds the `thread` root, the `reaction_message`, the `unicode_message`, and filler up to about
 * 20 messages. The `thread` fixture has a parent and two replies, and `user` is a workspace user.
 */
export function createSlackContractFake({
  startMock,
  createConnection,
}: {
  startMock: (options: {botToken: string; botUserId: string}) => Promise<SlackApiMock>;
  createConnection: (
    params: Parameters<typeof createSlackConnection>[0],
  ) => Promise<{slug: string}>;
}): ContractFakeAdapter {
  return async ({workspaceId, uniqueId, cleanups}) => {
    const botToken = `xoxb-contracts-${uniqueId}`;
    const botUserId = `Ubot${uniqueId}`;
    const teamId = `T${uniqueId}`;
    const mock = await startMock({botToken, botUserId});
    cleanups.push(() => mock.stop());
    const connection = await createConnection({
      workspaceId,
      teamId,
      teamName: `Contracts Slack ${uniqueId}`,
      appId: `A${uniqueId}`,
      botUserId,
      botToken,
      scopes: [
        'app_mentions:read',
        'channels:history',
        'channels:read',
        'chat:write',
        'users:read',
        'reactions:write',
        'canvases:read',
        'canvases:write',
      ],
    });

    return {
      connectionSlug: connection.slug,
      seed: (fixtures) => {
        return rejectingSeed(() => {
          const seeds = slackSeeds({fixtures, botUserId, teamId});
          if (seeds.user !== undefined) mock.seedUser(seeds.user);
          for (const channel of seeds.channels) mock.seedChannel(channel);
          if (seeds.thread !== undefined) mock.seedThread(seeds.thread);
        });
      },
      writes: () => mock.writes().map((write) => ({...write, kind: `slack.${write.kind}`})),
    };
  };
}

/** The Jira objects the fixtures describe, with the ids and fields of the sandbox. */
function jiraSeed(fixtures: SandboxFixtures): JiraSeed {
  const read = ({fixtureName, name}: {fixtureName: string; name: string}) =>
    String(
      requiredField({provider: 'jira', fixture: fixtures[fixtureName] ?? {}, fixtureName, name}),
    );
  const projects = ['read_project', 'write_project']
    .filter((fixtureName) => fixtures[fixtureName] !== undefined)
    .map((fixtureName) => ({
      key: read({fixtureName, name: 'key'}),
      id: read({fixtureName, name: 'id'}),
      name: read({fixtureName, name: 'name'}),
    }));
  const issue =
    fixtures.issue === undefined
      ? undefined
      : {
          key: read({fixtureName: 'issue', name: 'key'}),
          id: read({fixtureName: 'issue', name: 'id'}),
          summary: read({fixtureName: 'issue', name: 'summary'}),
        };
  if (fixtures.comment !== undefined && issue === undefined) {
    throw new Error('The jira comment fixture needs an issue fixture.');
  }
  const comment =
    fixtures.comment === undefined || issue === undefined
      ? undefined
      : {
          issueKey: issue.key,
          id: read({fixtureName: 'comment', name: 'id'}),
          body: read({fixtureName: 'comment', name: 'body'}),
        };
  const user =
    fixtures.user === undefined
      ? undefined
      : {
          accountId: read({fixtureName: 'user', name: 'account_id'}),
          displayName: read({fixtureName: 'user', name: 'display_name'}),
        };
  return {
    projects,
    issues: issue === undefined ? [] : [issue],
    comments: comment === undefined ? [] : [comment],
    users: user === undefined ? [] : [user],
  };
}

/**
 * Jira, with a connection to a fake of its own. It seeds the projects, the `issue` fixture and its
 * `comment`, and the `user`, with the ids and fields of the sandbox. The fake serves the Jira site
 * of the connection, so no site fixture is needed.
 */
export function createJiraContractFake({
  arrange = arrangeJiraTracker,
}: {
  /** Replaces the fake and its connection, which tests don't have a stack for. */
  arrange?: typeof arrangeJiraTracker;
} = {}): ContractFakeAdapter {
  return async ({workspaceId, uniqueId, cleanups}) => {
    const {mock, connectionSlug, writes} = await arrange({workspaceId, uniqueId, cleanups});
    return {
      connectionSlug,
      seed: (fixtures) => rejectingSeed(() => mock.seed(jiraSeed(fixtures))),
      writes,
    };
  };
}

export const slackContractFake = createSlackContractFake({
  startMock: startSlackApiMock,
  createConnection: createSlackConnection,
});

export const jiraContractFake = createJiraContractFake();

/**
 * PostHog, whose fake the harness runs for the whole stack and answers by API key. The adapter
 * connects the workspace to it with a key of its own, then seeds that key with the events, the
 * feature flags, the insight, the dashboard, the experiments, the survey, and the error-tracking
 * issue of the sandbox. The insight counts the `event` fixture, as the sandbox insight does.
 */
export const posthogContractFake: ContractFakeAdapter = async ({workspaceId, uniqueId}) => {
  const apiKey = `phx_contracts_${uniqueId}`;
  const connection = await createPosthogConnection({
    workspaceId,
    region: 'us',
    apiKey,
    projectId: `contracts-project-${uniqueId}`,
    projectName: `Contracts PostHog ${uniqueId}`,
    organizationId: `contracts-organization-${uniqueId}`,
  });
  return {
    connectionSlug: connection.slug,
    seed: async (fixtures) => {
      // Reads the named fixtures the sandbox has, each through a getter that rejects a missing field.
      const seeded = <T>(
        fixtureNames: string[],
        build: (fixture: {
          fixtureName: string;
          required: (name: string) => string | number | boolean;
          optional: (name: string) => string | number | boolean | undefined;
        }) => T,
      ): T[] =>
        fixtureNames.flatMap((fixtureName) => {
          const fixture = fixtures[fixtureName];
          if (fixture === undefined) return [];
          return [
            build({
              fixtureName,
              required: (name) => requiredField({provider: 'posthog', fixture, fixtureName, name}),
              optional: (name) => field({fixture, name}),
            }),
          ];
        });
      const events = seeded(['event', 'purchase_event'], ({required}) => ({
        name: String(required('name')),
        count: Number(required('count')),
      }));
      const countedEvent = fixtures.event === undefined ? undefined : events[0]?.name;
      await seedPosthogMock({
        apiKey,
        seed: {
          events,
          feature_flags: seeded(
            ['feature_flag', 'disabled_feature_flag'],
            ({fixtureName, required}) => ({
              id: Number(required('id')),
              key: String(required('key')),
              ...(fixtureName === 'disabled_feature_flag' ? {active: false} : {}),
            }),
          ),
          insights: seeded(['insight'], ({required}) => ({
            id: Number(required('id')),
            short_id: String(required('short_id')),
            name: String(required('name')),
            ...(countedEvent === undefined ? {} : {event: countedEvent}),
          })),
          dashboards: seeded(['dashboard'], ({required}) => ({
            id: Number(required('id')),
            name: String(required('name')),
          })),
          experiments: seeded(
            ['experiment', 'experiment_results'],
            ({fixtureName, required, optional}) => {
              const flagKey = optional('feature_flag_key');
              return {
                id: Number(required('id')),
                name: String(required('name')),
                ...(flagKey === undefined ? {} : {feature_flag_key: String(flagKey)}),
                ...(fixtureName === 'experiment_results'
                  ? {
                      results: {
                        exposures: Number(required('exposures_per_variant')),
                        control_sum: Number(required('control_sum')),
                        test_sum: Number(required('test_sum')),
                      },
                    }
                  : {}),
              };
            },
          ),
          surveys: seeded(['survey'], ({required}) => ({
            id: String(required('id')),
            name: String(required('name')),
            questions: [String(required('question'))],
          })),
          error_issues: seeded(['error_issue'], ({required}) => ({
            id: String(required('id')),
            name: String(required('name')),
          })),
        },
      });
    },
    // PostHog is read-only for Shipfox.
    writes: () => [],
  };
};

/**
 * Linear, with its own fake and a connection to it. The fake replays the calls recorded from the
 * sandbox workspace, one text block each as the hosted MCP sends them, for the sandbox fixtures
 * the 12 read cases name. The recordings hold the fixtures' ids and fields, so `seed` has nothing
 * to load: a case whose fixture changed in `sandbox.yaml` sends arguments with no recording and
 * fails on the fake until it is recorded again.
 */
export const linearContractFake: ContractFakeAdapter = async ({
  workspaceId,
  uniqueId,
  cleanups,
}) => {
  const accessToken = `lin_oauth_contracts_${uniqueId}`;
  const mock = await startLinearMcpMock({accessToken, recordings: await loadLinearRecordings()});
  cleanups.push(() => mock.stop());
  const connection = await createLinearConnection({
    workspaceId,
    organizationId: `contracts-org-${uniqueId}`,
    organizationUrlKey: `contracts-${uniqueId}`,
    appUserId: `contracts-app-${uniqueId}`,
    displayName: `Contracts Linear ${uniqueId}`,
    accessToken,
  });
  return {
    connectionSlug: connection.slug,
    seed: () => Promise.resolve(),
    writes: () => mock.writes(),
  };
};

/**
 * The adapter of each provider the suite can run in fake mode. A provider joins when its fake
 * parity unit adds its adapter, and its cases gain `fake` in `modes` in the same change.
 */
export const CONTRACT_FAKE_ADAPTERS: Readonly<Record<string, ContractFakeAdapter>> = {
  github: githubContractFake,
  discord: discordContractFake,
  clickup: clickupContractFake,
  notion: notionContractFake,
  posthog: posthogContractFake,
  slack: slackContractFake,
  jira: jiraContractFake,
  linear: linearContractFake,
};
