import {mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import type {DefinitionResponseDto} from '@shipfox/api-definitions-dto';
import {createApiClient} from '@shipfox/e2e-core';
import {startGithubApiMock} from '@shipfox/e2e-driver-github';
import {stopLocalRunner} from '@shipfox/e2e-driver-runner-process';
import {observeRun, waitForRunByDeliveryId} from '@shipfox/e2e-observe-workflows';
import {createSession, createUser} from '@shipfox/e2e-setup-auth';
import {createGithubConnection} from '@shipfox/e2e-setup-integrations';
import {createProject} from '@shipfox/e2e-setup-projects';
import {createWorkspace} from '@shipfox/e2e-setup-workspaces';
import {attachLocalRunnerLog} from '#attachments.js';
import {stepLogText} from '#listener-jobs.js';
import {waitForDefinitionSyncTerminal} from '#polling.js';
import {startSuiteLocalRunner, waitForRunTerminalOrFailedRunner} from '#runner.js';
import {expect, test} from './fixtures.js';

const SYNC_TIMEOUT_MS = 60_000;
const RUN_LOOKUP_TIMEOUT_MS = 15_000;
const RUN_TIMEOUT_MS = 180_000;
const MAX_TRIGGER_ATTEMPTS = 8;
const RUNNER_LABEL_PLACEHOLDER = '__RUNNER_LABEL__';
const WORKFLOW_PATH = '.github/workflows/ci.yml';
const DEFAULT_BRANCH = 'trunk';
const FAILED_SHA = 'f'.repeat(40);

// The filter copies the shape of fix-default-branch-ci's trigger, so the payload the fake sends
// has to carry every field that template reads.
function workflowRunWorkflow(params: {repository: string}): string {
  return `
name: GitHub workflow run events
runner: ${RUNNER_LABEL_PLACEHOLDER}
triggers:
  on_default_branch_failure:
    source: __GITHUB_SOURCE__
    event: workflow_run.completed
    filter: >-
      event.repository.full_name == "${params.repository}" &&
      event.workflow_run.path in ["${WORKFLOW_PATH}"] &&
      event.workflow_run.conclusion == "failure" &&
      event.workflow_run.head_branch == event.repository.default_branch &&
      event.workflow_run.head_repository.full_name == event.repository.full_name &&
      event.workflow_run.event in ["push", "schedule"] &&
      event.workflow_run.run_attempt == 1
jobs:
  investigate:
    checkout: false
    steps:
      - key: show_run
        env:
          CONCLUSION: '\${{ event.workflow_run.conclusion }}'
          HEAD_BRANCH: '\${{ event.workflow_run.head_branch }}'
          HEAD_SHA: '\${{ event.workflow_run.head_sha }}'
          WORKFLOW_NAME: '\${{ event.workflow_run.name }}'
        run: |
          echo "conclusion=$CONCLUSION"
          echo "head_branch=$HEAD_BRANCH"
          echo "head_sha=$HEAD_SHA"
          echo "workflow_name=$WORKFLOW_NAME"
`;
}

test('starts a run from a failed workflow run on the default branch', async ({suite}, testInfo) => {
  const uniqueId = crypto.randomUUID().replaceAll('-', '').slice(0, 10);
  const installationId = Number.parseInt(uniqueId.slice(0, 7), 16) + 1;
  const installationToken = `ghs_${uniqueId}.${'e'.repeat(36)}.${'f'.repeat(36)}`;
  const githubApi = await startGithubApiMock({installationId, installationToken});
  const seedDirectory = await mkdtemp(join(tmpdir(), 'github-workflow-run-e2e-'));
  const runnerLabel = `e2e-github-workflow-run-${uniqueId}`;
  let stopRunner: (() => Promise<void>) | undefined;
  let runnerLogFile: string | undefined;
  try {
    await writeFile(join(seedDirectory, 'README.md'), '# report-cli\n');
    const repository = await githubApi.addRepository({
      owner: 'acme',
      name: `report-cli-${uniqueId}`,
      seedDirectory,
      defaultBranch: DEFAULT_BRANCH,
    });

    // A GitHub connection resyncs every project in its workspace when it becomes available, so
    // this test gets a workspace of its own.
    const user = await createUser({name: `GitHub workflow runs ${uniqueId}`});
    const workspace = await createWorkspace({
      userId: user.user.id,
      userEmail: user.email,
      name: `GitHub workflow runs ${suite.runId} ${uniqueId}`,
    });
    const session = await createSession({user_id: user.user.id});
    const client = createApiClient({token: session.token});
    const connection = await createGithubConnection({
      workspaceId: workspace.id,
      installationId,
      accountLogin: repository.owner,
      displayName: `GitHub workflow runs ${uniqueId}`,
      installerUserId: crypto.randomUUID(),
      lifecycleStatus: 'disabled',
    });
    await client.request('patch', `/integration-connections/${connection.id}`, {
      json: {lifecycle_status: 'active'},
    });
    const project = await createProject({
      workspaceId: workspace.id,
      name: `GitHub workflow runs project ${uniqueId}`,
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
      name: `E2E GitHub workflow runs ${uniqueId}`,
      runnerLabel,
    });
    runnerLogFile = localRunner.logFile;
    stopRunner = () => stopLocalRunner(localRunner.runner).catch(() => undefined);
    await client.requestJson<DefinitionResponseDto>('post', '/definitions', {
      json: {
        project_id: project.id,
        source: 'manual',
        yaml: workflowRunWorkflow({repository: repository.fullName})
          .replaceAll(RUNNER_LABEL_PLACEHOLDER, runnerLabel)
          .replaceAll('__GITHUB_SOURCE__', connection.slug),
      },
    });

    // A delivery that lands before the definition's subscription activates starts no run, so the
    // sender retries until one appears.
    let started: {runId: string; deliveryId: string} | undefined;
    let lastError: unknown;
    for (let attempt = 1; attempt <= MAX_TRIGGER_ATTEMPTS && started === undefined; attempt += 1) {
      const failed = await githubApi.sendWorkflowRunCompleted({
        repository: repository.fullName,
        conclusion: 'failure',
        headBranch: DEFAULT_BRANCH,
        headSha: FAILED_SHA,
        workflowPath: WORKFLOW_PATH,
        workflowName: 'CI',
      });
      try {
        const run = await waitForRunByDeliveryId({
          projectId: project.id,
          workspaceId: workspace.id,
          deliveryId: failed.deliveryId,
          token: session.token,
          timeoutMs: RUN_LOOKUP_TIMEOUT_MS,
        });
        started = {runId: run.id, deliveryId: failed.deliveryId};
      } catch (error) {
        lastError = error;
      }
    }
    if (started === undefined) {
      throw lastError instanceof Error
        ? lastError
        : new Error(`No run appeared after ${MAX_TRIGGER_ATTEMPTS} failed workflow runs.`);
    }

    const terminal = await waitForRunTerminalOrFailedRunner({
      runId: started.runId,
      token: session.token,
      timeoutMs: RUN_TIMEOUT_MS,
      runner: localRunner.runner,
      selection: {
        jobs: [{jobKey: 'investigate', executionSequences: 'all', stepKeys: ['show_run']}],
      },
    });
    expect(terminal.status).toBe('succeeded');
    const observation = await observeRun({
      runId: started.runId,
      token: session.token,
      selection: {jobs: [{jobKey: 'investigate', stepKeys: ['show_run']}]},
    });
    const logs = await stepLogText({
      observation,
      token: session.token,
      jobKey: 'investigate',
      sequence: 1,
      stepKey: 'show_run',
    });
    expect(logs).toContain('conclusion=failure');
    expect(logs).toContain(`head_branch=${DEFAULT_BRANCH}`);
    expect(logs).toContain(`head_sha=${FAILED_SHA}`);
    expect(logs).toContain('workflow_name=CI');
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
    await githubApi.stop();
    await rm(seedDirectory, {recursive: true, force: true});
  }
});
