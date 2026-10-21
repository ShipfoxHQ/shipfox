import {mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import type {
  TriggerEventDetailResponseDto,
  TriggerEventListResponseDto,
} from '@shipfox/api-triggers-dto';
import {createApiClient, pollUntil} from '@shipfox/e2e-core';
import {type GithubApiMock, startGithubApiMock} from '@shipfox/e2e-driver-github';
import {stopLocalRunner} from '@shipfox/e2e-driver-runner-process';
import {createSession, createUser} from '@shipfox/e2e-setup-auth';
import {
  createGithubConnection,
  type IntegrationConnectionDto,
} from '@shipfox/e2e-setup-integrations';
import {createProject} from '@shipfox/e2e-setup-projects';
import {createWorkspace} from '@shipfox/e2e-setup-workspaces';
import {attachLocalRunnerLog} from '#attachments.js';
import {waitForDefinitionSyncTerminal} from '#polling.js';
import {startSuiteLocalRunner, waitForRunTerminalOrFailedRunner} from '#runner.js';
import {expect, test} from './fixtures.js';

// Two real cron ticks, a minute apart at most, plus one run.
const TEST_TIMEOUT_MS = 480_000;
const SYNC_TIMEOUT_MS = 60_000;
const CONNECTION_TIMEOUT_MS = 30_000;
const TICK_TIMEOUT_MS = 150_000;
const RUN_TIMEOUT_MS = 120_000;
const RUNNER_LABEL_PLACEHOLDER = '__RUNNER_LABEL__';

// The job keeps its default checkout, so it needs the project's source connection.
const workflowYaml = `
name: GitHub installation lifecycle
runner: ${RUNNER_LABEL_PLACEHOLDER}
triggers:
  every_minute:
    source: cron
    event: tick
    config:
      schedule: "* * * * *"
jobs:
  build:
    steps:
      - key: show
        run: test -f README.md && echo "checked_out"
`;

type ApiClient = ReturnType<typeof createApiClient>;

test('an uninstall stops cron runs, and a reinstall restores the same connection', async ({
  suite,
}, testInfo) => {
  test.setTimeout(TEST_TIMEOUT_MS);
  const uniqueId = crypto.randomUUID().replaceAll('-', '').slice(0, 10);
  const installationId = Number.parseInt(uniqueId.slice(0, 7), 16) + 1;
  const reinstallationId = installationId + 1;
  const accountId = Number.parseInt(uniqueId.slice(3, 10), 16) + 1;
  const seedDirectory = await mkdtemp(join(tmpdir(), 'github-installation-lifecycle-e2e-'));
  const runnerLabel = `e2e-github-installation-${uniqueId}`;
  const githubApis: GithubApiMock[] = [];
  let stopRunner: (() => Promise<void>) | undefined;
  let runnerLogFile: string | undefined;
  try {
    await writeFile(join(seedDirectory, 'README.md'), '# report-cli\n');
    const installed = await startGithubApi({
      installationId,
      installationToken: installationTokenFor(`${uniqueId}a`),
      githubApis,
    });
    const repository = await installed.addRepository({
      owner: 'acme',
      name: `report-cli-${uniqueId}`,
      seedDirectory,
    });
    const account = {login: repository.owner, id: accountId};

    // A GitHub connection resyncs every project in its workspace when it becomes available, so
    // this test gets a workspace of its own.
    const user = await createUser({name: `GitHub installation ${uniqueId}`});
    const workspace = await createWorkspace({
      userId: user.user.id,
      userEmail: user.email,
      name: `GitHub installation ${suite.runId} ${uniqueId}`,
    });
    const session = await createSession({user_id: user.user.id});
    const client = createApiClient({token: session.token});
    const connection = await createGithubConnection({
      workspaceId: workspace.id,
      installationId,
      accountLogin: account.login,
      accountId: account.id,
      displayName: `GitHub installation ${uniqueId}`,
      installerUserId: crypto.randomUUID(),
    });
    const project = await createProject({
      workspaceId: workspace.id,
      name: `GitHub installation project ${uniqueId}`,
      sourceConnectionId: connection.id,
      sourceExternalRepositoryId: `github:${repository.id}`,
      sourceRepositoryOwner: repository.owner,
      sourceRepositoryName: repository.name,
      sourceDefaultBranch: repository.defaultBranch,
    });
    await waitForDefinitionSyncTerminal({
      projectId: project.id,
      token: session.token,
      timeoutMs: SYNC_TIMEOUT_MS,
    });
    const localRunner = await startSuiteLocalRunner({
      workspaceId: workspace.id,
      userToken: session.token,
      name: `E2E GitHub installation ${uniqueId}`,
      runnerLabel,
    });
    runnerLogFile = localRunner.logFile;
    stopRunner = () => stopLocalRunner(localRunner.runner).catch(() => undefined);
    await client.request('post', '/definitions', {
      json: {
        project_id: project.id,
        source: 'manual',
        yaml: workflowYaml.replaceAll(RUNNER_LABEL_PLACEHOLDER, runnerLabel),
      },
    });

    await test.step('an uninstall stops cron runs', async () => {
      await installed.sendInstallationDeleted({account});

      const uninstalled = await waitForConnection({
        client,
        workspaceId: workspace.id,
        connectionId: connection.id,
        lifecycleStatus: 'error',
      });
      expect(uninstalled.provider_access).toBe('removed');
      const tick = await waitForCronEvent({
        client,
        workspaceId: workspace.id,
        outcome: 'errored',
      });
      expect(tick.decisions).toEqual([
        expect.objectContaining({
          project_id: project.id,
          decision: 'dispatch-error',
          diagnostic: expect.objectContaining({code: 'source-connection-unavailable'}),
          run_id: null,
        }),
      ]);
    });

    await test.step('a reinstall restores the same connection and resumes cron runs', async () => {
      // A reinstall gets a new installation ID, so the fake that serves it registers that ID.
      await installed.stop();
      const reinstalled = await startGithubApi({
        installationId: reinstallationId,
        installationToken: installationTokenFor(`${uniqueId}b`),
        githubApis,
      });
      const restoredRepository = await reinstalled.addRepository({
        owner: repository.owner,
        name: repository.name,
        seedDirectory,
      });
      expect(restoredRepository.id).toBe(repository.id);
      const reinstalledAt = new Date();

      const reattached = await createGithubConnection({
        workspaceId: workspace.id,
        installationId: reinstallationId,
        accountLogin: account.login,
        accountId: account.id,
        displayName: `GitHub installation ${uniqueId}`,
        installerUserId: crypto.randomUUID(),
      });
      expect(reattached).toMatchObject({
        id: connection.id,
        slug: connection.slug,
        lifecycle_status: 'active',
      });
      const tick = await waitForCronEvent({
        client,
        workspaceId: workspace.id,
        outcome: 'routed',
        from: reinstalledAt,
      });
      const runId = tick.decisions.find((decision) => decision.decision === 'triggered')?.run_id;
      expect(runId).toEqual(expect.any(String));
      const run = await waitForRunTerminalOrFailedRunner({
        runId: String(runId),
        token: session.token,
        timeoutMs: RUN_TIMEOUT_MS,
        runner: localRunner.runner,
      });
      expect(run.status).toBe('succeeded');
    });
  } finally {
    if (runnerLogFile !== undefined) {
      const logFile = runnerLogFile;
      await attachLocalRunnerLog(
        (attachment) =>
          testInfo.attach(attachment.name, {
            body: attachment.body,
            contentType: attachment.contentType,
          }),
        logFile,
      ).catch(() => undefined);
    }
    await stopRunner?.();
    await Promise.all(githubApis.map((githubApi) => githubApi.stop().catch(() => undefined)));
    await rm(seedDirectory, {recursive: true, force: true});
  }
});

function installationTokenFor(seed: string): string {
  return `ghs_${seed}.${'e'.repeat(36)}.${'f'.repeat(36)}`;
}

async function startGithubApi(params: {
  installationId: number;
  installationToken: string;
  githubApis: GithubApiMock[];
}): Promise<GithubApiMock> {
  const githubApi = await startGithubApiMock({
    installationId: params.installationId,
    installationToken: params.installationToken,
  });
  params.githubApis.push(githubApi);
  return githubApi;
}

async function waitForConnection(params: {
  client: ApiClient;
  workspaceId: string;
  connectionId: string;
  lifecycleStatus: IntegrationConnectionDto['lifecycle_status'];
}): Promise<IntegrationConnectionDto> {
  let observed = 'not listed';
  return await pollUntil<IntegrationConnectionDto>(
    {
      timeoutMs: CONNECTION_TIMEOUT_MS,
      intervalMs: 250,
      maxIntervalMs: 1_000,
      describe: () =>
        `connection ${params.connectionId} to be ${params.lifecycleStatus}, last ${observed}`,
    },
    async () => {
      const search = new URLSearchParams({workspace_id: params.workspaceId});
      const {connections} = await params.client.requestJson<{
        connections: IntegrationConnectionDto[];
      }>('get', `/integration-connections?${search}`);
      const connection = connections.find((candidate) => candidate.id === params.connectionId);
      observed = connection?.lifecycle_status ?? 'not listed';
      return connection?.lifecycle_status === params.lifecycleStatus ? connection : null;
    },
  );
}

async function waitForCronEvent(params: {
  client: ApiClient;
  workspaceId: string;
  outcome: 'errored' | 'routed';
  from?: Date | undefined;
}): Promise<TriggerEventDetailResponseDto> {
  const event = await pollUntil(
    {
      timeoutMs: TICK_TIMEOUT_MS,
      intervalMs: 1_000,
      maxIntervalMs: 2_000,
      describe: () => `a cron tick with outcome ${params.outcome}`,
    },
    async () => {
      const search = new URLSearchParams({
        workspace_id: params.workspaceId,
        origin: 'cron',
        outcome: params.outcome,
        ...(params.from === undefined ? {} : {from: params.from.toISOString()}),
      });
      const {trigger_events: events} = await params.client.requestJson<TriggerEventListResponseDto>(
        'get',
        `/trigger-events?${search}`,
      );
      return events.at(-1) ?? null;
    },
  );
  return await params.client.requestJson<TriggerEventDetailResponseDto>(
    'get',
    `/trigger-events/${event.id}`,
  );
}
