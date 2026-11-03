import {mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {
  commitConfigChangesResultSchema,
  createDevRunResultSchema,
} from '@shipfox/api-agent-access-dto';
import type {CreateProjectBodyDto, ProjectResponseDto} from '@shipfox/api-projects-dto';
import {createApiClient} from '@shipfox/e2e-core';
import {GITHUB_READ_RESULT_MARKER, startGithubApiMock} from '@shipfox/e2e-driver-github';
import {stopLocalRunner} from '@shipfox/e2e-driver-runner-process';
import {createSession, createUser} from '@shipfox/e2e-setup-auth';
import {createGithubConnection} from '@shipfox/e2e-setup-integrations';
import {createWorkspace} from '@shipfox/e2e-setup-workspaces';
import {callTool, connectAgentAccessMcp} from '#agent-access-mcp.js';
import {
  attachLocalRunnerLog,
  collectStepLogAttachmentRequests,
  fetchLogAttachment,
} from '#attachments.js';
import {waitForDefinitionSyncTerminal} from '#polling.js';
import {startSuiteLocalRunner, waitForRunTerminalOrFailedRunner} from '#runner.js';
import {expect, test} from './fixtures.js';

const RUN_TIMEOUT_MS = 180_000;
const SYNC_TIMEOUT_MS = 60_000;
const SEED_PATH = '.shipfox/workflows/hello.yml';
const BRANCH_PATH = '.shipfox/workflows/inspect-app.yml';
const BRANCH = 'shipfox/inspect-app';

function seedWorkflow(runnerLabel: string): string {
  return `name: Hello
runner: ${runnerLabel}
triggers:
  manual:
    source: manual
    event: fire
jobs:
  hello:
    steps:
      - run: echo hello
`;
}

// Neither the checkout nor the tool names a connection: a managed project uses the workspace's
// only source-control connection.
function branchWorkflow(params: {runnerLabel: string; repository: string}): string {
  const [owner, repo] = params.repository.split('/');
  return `name: Inspect app
runner: ${params.runnerLabel}
triggers:
  manual:
    source: manual
    event: fire
jobs:
  inspect:
    steps:
      - key: code
        checkout:
          repository: ${params.repository}
      - key: read
        run: test "$(cat src/index.ts)" = "export const value = 1;"
      - key: issue
        tool: issue_read.get
        with:
          owner: ${owner}
          repo: ${repo}
          issue_number: 1
        outputs:
          marker: \${{ result.marker }}
`;
}

test('a managed project in a new workspace syncs, and a branch dev run checks out a repository and calls a GitHub tool with no connection', async ({
  request,
  suite,
}, testInfo) => {
  const uniqueId = crypto.randomUUID().replaceAll('-', '').slice(0, 10);
  const installationId = Number.parseInt(uniqueId.slice(0, 7), 16) + 1;
  const installationToken = `ghs_${uniqueId}.${'e'.repeat(36)}.${'f'.repeat(36)}`;
  const githubApi = await startGithubApiMock({installationId, installationToken});
  const seedDirectory = await mkdtemp(join(tmpdir(), 'managed-config-e2e-'));
  const runnerLabel = `e2e-managed-config-${uniqueId}`;
  let closeClient: (() => Promise<void>) | undefined;
  let stopRunner: (() => Promise<void>) | undefined;
  try {
    await mkdir(join(seedDirectory, 'src'));
    await writeFile(join(seedDirectory, 'src', 'index.ts'), 'export const value = 1;\n');
    const repository = await githubApi.addRepository({
      owner: 'acme',
      name: `app-${uniqueId}`,
      seedDirectory,
    });

    const user = await createUser({name: `Managed config ${uniqueId}`});
    const workspace = await createWorkspace({
      userId: user.user.id,
      userEmail: user.email,
      name: `Managed config ${suite.runId} ${uniqueId}`,
    });
    const session = await createSession({user_id: user.user.id});
    const workspaceSuite = {...suite, workspaceId: workspace.id, sessionToken: session.token};
    const client = createApiClient({token: session.token});
    const connection = await createGithubConnection({
      workspaceId: workspace.id,
      installationId,
      accountLogin: repository.owner,
      displayName: `Managed config ${uniqueId}`,
      installerUserId: crypto.randomUUID(),
      lifecycleStatus: 'disabled',
    });
    await client.request('patch', `/integration-connections/${connection.id}`, {
      json: {lifecycle_status: 'active'},
    });

    const body: CreateProjectBodyDto = {
      workspace_id: workspace.id,
      name: `Managed ${uniqueId}`,
      slug: `managed-${uniqueId}`,
      source: {kind: 'managed', files: [{path: SEED_PATH, content: seedWorkflow(runnerLabel)}]},
    };
    const project = await client.requestJson<ProjectResponseDto>('post', '/projects', {
      json: body,
    });
    expect(project.source.kind).toBe('managed');

    const definitions = await waitForDefinitionSyncTerminal({
      projectId: project.id,
      token: session.token,
      timeoutMs: SYNC_TIMEOUT_MS,
    });
    expect(definitions.sync?.status).toBe('succeeded');
    expect(definitions.definitions.map((definition) => definition.config_path)).toEqual([
      SEED_PATH,
    ]);

    const mcp = await connectAgentAccessMcp({
      request,
      suite: workspaceSuite,
      uniqueId,
      clientName: 'Managed config',
    });
    closeClient = () => mcp.close();

    const committed = await callTool(mcp, 'commit_config_changes', {
      project_id: project.id,
      branch: BRANCH,
      message: 'Inspect the app',
      changes: [
        {
          path: BRANCH_PATH,
          content: branchWorkflow({runnerLabel, repository: repository.fullName}),
        },
      ],
    });
    if (!committed.envelope.ok) {
      throw new Error(`commit_config_changes failed: ${JSON.stringify(committed.envelope)}`);
    }
    const commit = commitConfigChangesResultSchema.parse(committed.envelope.result);

    const localRunner = await startSuiteLocalRunner({
      workspaceId: workspace.id,
      userToken: session.token,
      name: `E2E managed config ${uniqueId}`,
      runnerLabel,
    });
    stopRunner = () => stopLocalRunner(localRunner.runner).catch(() => undefined);
    githubApi.calls.length = 0;

    const devRun = await callTool(mcp, 'create_dev_run', {
      project_id: project.id,
      ref: BRANCH,
      commit: commit.commit,
      config_path: BRANCH_PATH,
      trigger: 'manual',
    });
    if (!devRun.envelope.ok) {
      throw new Error(`create_dev_run failed: ${JSON.stringify(devRun.envelope)}`);
    }
    const devRunResult = createDevRunResultSchema.parse(devRun.envelope.result);
    if (!('run_id' in devRunResult)) throw new Error('The dev run did not return a run id');

    const observation = await waitForRunTerminalOrFailedRunner({
      runId: devRunResult.run_id,
      token: session.token,
      timeoutMs: RUN_TIMEOUT_MS,
      runner: localRunner.runner,
      selection: {
        jobs: [
          {jobKey: 'inspect', includeDefaultExecution: true, stepKeys: ['code', 'read', 'issue']},
        ],
      },
    });
    for (const logRequest of collectStepLogAttachmentRequests(observation)) {
      const attachment = await fetchLogAttachment(logRequest, session.token);
      await testInfo.attach(attachment.name, {
        body: attachment.body,
        contentType: attachment.contentType,
      });
    }
    await attachLocalRunnerLog(
      (attachment) =>
        testInfo.attach(attachment.name, {
          body: attachment.body,
          contentType: attachment.contentType,
        }),
      localRunner.logFile,
    );

    expect(observation).toMatchObject({status: 'succeeded', origin: 'dev'});
    const issue = observation.jobs
      .find((job) => job.key === 'inspect')
      ?.executions.flatMap((execution) => execution.steps)
      .find((step) => step.key === 'issue');
    expect(issue?.outputs).toMatchObject({marker: GITHUB_READ_RESULT_MARKER});
    expect(githubApi.calls.filter((call) => call.kind === 'read-issue')).toEqual([
      expect.objectContaining({owner: repository.owner, repo: repository.name, issueNumber: 1}),
    ]);
  } finally {
    await closeClient?.().catch(() => undefined);
    await stopRunner?.();
    await githubApi.stop();
    await rm(seedDirectory, {recursive: true, force: true});
  }
});
