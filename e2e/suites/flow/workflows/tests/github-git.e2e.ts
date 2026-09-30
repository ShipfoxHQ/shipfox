import {execFile} from 'node:child_process';
import {mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {promisify} from 'node:util';
import type {DefinitionResponseDto} from '@shipfox/api-definitions-dto';
import {createApiClient} from '@shipfox/e2e-core';
import {startGithubApiMock} from '@shipfox/e2e-driver-github';
import {stopLocalRunner} from '@shipfox/e2e-driver-runner-process';
import {createSession, createUser} from '@shipfox/e2e-setup-auth';
import {createGithubConnection} from '@shipfox/e2e-setup-integrations';
import {createProject} from '@shipfox/e2e-setup-projects';
import {createWorkspace} from '@shipfox/e2e-setup-workspaces';
import {
  attachLocalRunnerLog,
  collectStepLogAttachmentRequests,
  fetchLogAttachment,
} from '#attachments.js';
import {
  GITHUB_SOURCE_RUNNER_LABEL_PLACEHOLDER,
  githubSourcePartsWorkflowYaml,
} from '#github-source.js';
import {waitForDefinitionSyncTerminal} from '#polling.js';
import {startSuiteLocalRunner, waitForRunTerminalOrFailedRunner} from '#runner.js';
import {fireManualAndAwaitRun} from '#triggers.js';
import {expect, test} from './fixtures.js';

const execFileAsync = promisify(execFile);
const RUN_TIMEOUT_MS = 180_000;
const SYNC_TIMEOUT_MS = 60_000;
const BRANCH_PATTERN = /^shipfox\/task-1-\d+-1$/u;

// The fake serves the repository over git at /github.com/<owner>/<repo>.git, so the shipped
// prepare step reads `owner/repo` from the remote URL like it does against github.com.
test('the shipped GitHub source parts check out the fake repository and push a branch to it', async ({
  suite,
}, testInfo) => {
  const uniqueId = crypto.randomUUID().replaceAll('-', '').slice(0, 10);
  const installationId = Number.parseInt(uniqueId.slice(0, 7), 16) + 1;
  const installationToken = `ghs_${uniqueId}.${'e'.repeat(36)}.${'f'.repeat(36)}`;
  const githubApi = await startGithubApiMock({installationId, installationToken});
  const seedDirectory = await mkdtemp(join(tmpdir(), 'github-git-e2e-'));
  const runnerLabel = `e2e-github-git-${uniqueId}`;
  let stopRunner: (() => Promise<void>) | undefined;
  try {
    await mkdir(join(seedDirectory, 'src'));
    await writeFile(join(seedDirectory, 'src', 'index.ts'), 'export const value = 1;\n');
    const repository = await githubApi.addRepository({
      owner: 'acme',
      name: `report-cli-${uniqueId}`,
      seedDirectory,
    });

    // A GitHub connection resyncs every project in its workspace when it becomes available, so
    // this test gets a workspace of its own.
    const user = await createUser({name: `GitHub git ${uniqueId}`});
    const workspace = await createWorkspace({
      userId: user.user.id,
      userEmail: user.email,
      name: `GitHub git ${suite.runId} ${uniqueId}`,
    });
    const session = await createSession({user_id: user.user.id});
    const client = createApiClient({token: session.token});
    const connection = await createGithubConnection({
      workspaceId: workspace.id,
      installationId,
      accountLogin: repository.owner,
      displayName: `GitHub git ${uniqueId}`,
      installerUserId: crypto.randomUUID(),
      lifecycleStatus: 'disabled',
    });
    await client.request('patch', `/integration-connections/${connection.id}`, {
      json: {lifecycle_status: 'active'},
    });
    const project = await createProject({
      workspaceId: workspace.id,
      name: `GitHub git project ${uniqueId}`,
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
      name: `E2E GitHub git ${uniqueId}`,
      runnerLabel,
    });
    stopRunner = () => stopLocalRunner(localRunner.runner).catch(() => undefined);
    const definition = await client.requestJson<DefinitionResponseDto>('post', '/definitions', {
      json: {
        project_id: project.id,
        source: 'manual',
        yaml: githubSourcePartsWorkflowYaml().replaceAll(
          GITHUB_SOURCE_RUNNER_LABEL_PLACEHOLDER,
          runnerLabel,
        ),
      },
    });
    const runId = await fireManualAndAwaitRun({
      client,
      definitionId: definition.id,
      inputs: {},
      scenario: 'github-git',
    });
    const observation = await waitForRunTerminalOrFailedRunner({
      runId,
      token: session.token,
      timeoutMs: RUN_TIMEOUT_MS,
      runner: localRunner.runner,
      selection: {
        jobs: [
          {
            jobKey: 'implement',
            includeDefaultExecution: true,
            stepKeys: ['task', 'prepare', 'fix', 'push'],
          },
        ],
      },
    });
    for (const request of collectStepLogAttachmentRequests(observation)) {
      const attachment = await fetchLogAttachment(request, session.token);
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

    expect(observation.status).toBe('succeeded');
    const prepare = observation.jobs
      .find((job) => job.key === 'implement')
      ?.executions.flatMap((execution) => execution.steps)
      .find((step) => step.key === 'prepare');
    expect(prepare?.outputs).toMatchObject({
      base: repository.defaultBranch,
      repository: repository.fullName,
      owner: repository.owner,
      repo: repository.name,
    });
    const branch = String(prepare?.outputs?.branch);
    expect(branch).toMatch(BRANCH_PATTERN);
    const {stdout} = await execFileAsync('git', [
      '--git-dir',
      repository.path,
      'rev-parse',
      `refs/heads/${branch}`,
    ]);
    expect(githubApi.writes()).toEqual([
      {
        kind: 'push',
        target: `${repository.fullName}:${branch}`,
        payload: {repository: repository.fullName, branch, before: null, after: stdout.trim()},
      },
    ]);
  } finally {
    await stopRunner?.();
    await githubApi.stop();
    await rm(seedDirectory, {recursive: true, force: true});
  }
});
