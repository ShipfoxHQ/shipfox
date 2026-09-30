import {mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import type {DefinitionResponseDto} from '@shipfox/api-definitions-dto';
import {createApiClient} from '@shipfox/e2e-core';
import {startGithubApiMock} from '@shipfox/e2e-driver-github';
import {stopLocalRunner} from '@shipfox/e2e-driver-runner-process';
import {observeRun} from '@shipfox/e2e-observe-workflows';
import {createSession, createUser} from '@shipfox/e2e-setup-auth';
import {createGithubConnection} from '@shipfox/e2e-setup-integrations';
import {createProject} from '@shipfox/e2e-setup-projects';
import {createWorkspace} from '@shipfox/e2e-setup-workspaces';
import {attachLocalRunnerLog} from '#attachments.js';
import {
  waitForListenerExecution,
  waitForListenerResolution,
  waitForListenerStatus,
} from '#listener-helpers.js';
import {LISTENER_JOB, stepLogText} from '#listener-jobs.js';
import {waitForDefinitionSyncTerminal} from '#polling.js';
import {startSuiteLocalRunner, waitForRunTerminalOrFailedRunner} from '#runner.js';
import {fireManualAndAwaitRun} from '#triggers.js';
import {expect, test} from './fixtures.js';

const SYNC_TIMEOUT_MS = 60_000;
const LISTENER_TIMEOUT_MS = 60_000;
const RUN_TIMEOUT_MS = 180_000;
const RUNNER_LABEL_PLACEHOLDER = '__RUNNER_LABEL__';
const REVIEW_COMMENT = 'Rename the flag to --format json.';

// The filters copy the shape of ticket-to-pr's feedback listener, so the payloads the fake sends
// have to carry every field that template reads.
function pullRequestListenerWorkflow(params: {
  connection: string;
  repository: string;
  pullNumber: number;
}): string {
  const {connection, repository, pullNumber} = params;
  return `
name: GitHub pull request events
runner: ${RUNNER_LABEL_PLACEHOLDER}
triggers:
  manual:
    source: manual
    event: fire
jobs:
  ${LISTENER_JOB}:
    checkout: false
    listening:
      on:
        - source: ${connection}
          event: pull_request_review_comment.created
          filter: >-
            event.repository.full_name == "${repository}" &&
            event.pull_request.number == ${pullNumber} &&
            (event.comment.author_association in ["OWNER", "MEMBER", "COLLABORATOR"] ||
              event.comment.user.type == "Bot")
      until:
        - source: ${connection}
          event: pull_request.closed
          filter: >-
            event.repository.full_name == "${repository}" &&
            event.number == ${pullNumber}
    steps:
      - key: show_comment
        env:
          COMMENT_BODY: '\${{ execution.events[0].data.comment.body }}'
          COMMENT_PATH: '\${{ execution.events[0].data.comment.path }}'
          COMMENT_AUTHOR: '\${{ execution.events[0].data.comment.user.login }}'
        run: |
          echo "comment_body=$COMMENT_BODY"
          echo "comment_path=$COMMENT_PATH"
          echo "comment_author=$COMMENT_AUTHOR"
`;
}

test('a listening job receives a pull request review comment and resolves when the pull request closes', async ({
  suite,
}, testInfo) => {
  const uniqueId = crypto.randomUUID().replaceAll('-', '').slice(0, 10);
  const installationId = Number.parseInt(uniqueId.slice(0, 7), 16) + 1;
  const installationToken = `ghs_${uniqueId}.${'e'.repeat(36)}.${'f'.repeat(36)}`;
  const githubApi = await startGithubApiMock({installationId, installationToken});
  const seedDirectory = await mkdtemp(join(tmpdir(), 'github-pull-request-events-e2e-'));
  const runnerLabel = `e2e-github-pr-events-${uniqueId}`;
  let stopRunner: (() => Promise<void>) | undefined;
  let runnerLogFile: string | undefined;
  try {
    await writeFile(join(seedDirectory, 'README.md'), '# report-cli\n');
    const repository = await githubApi.addRepository({
      owner: 'acme',
      name: `report-cli-${uniqueId}`,
      seedDirectory,
    });
    const pullNumber = 1;
    githubApi.pullRequests.set(pullNumber, {
      repository: repository.fullName,
      ref: 'shipfox/task-1-1-1',
      sha: 'a'.repeat(40),
      draft: true,
    });

    // A GitHub connection resyncs every project in its workspace when it becomes available, so
    // this test gets a workspace of its own.
    const user = await createUser({name: `GitHub events ${uniqueId}`});
    const workspace = await createWorkspace({
      userId: user.user.id,
      userEmail: user.email,
      name: `GitHub events ${suite.runId} ${uniqueId}`,
    });
    const session = await createSession({user_id: user.user.id});
    const client = createApiClient({token: session.token});
    const connection = await createGithubConnection({
      workspaceId: workspace.id,
      installationId,
      accountLogin: repository.owner,
      displayName: `GitHub events ${uniqueId}`,
      installerUserId: crypto.randomUUID(),
      lifecycleStatus: 'disabled',
    });
    await client.request('patch', `/integration-connections/${connection.id}`, {
      json: {lifecycle_status: 'active'},
    });
    const project = await createProject({
      workspaceId: workspace.id,
      name: `GitHub events project ${uniqueId}`,
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
      name: `E2E GitHub events ${uniqueId}`,
      runnerLabel,
    });
    runnerLogFile = localRunner.logFile;
    stopRunner = () => stopLocalRunner(localRunner.runner).catch(() => undefined);
    const definition = await client.requestJson<DefinitionResponseDto>('post', '/definitions', {
      json: {
        project_id: project.id,
        source: 'manual',
        yaml: pullRequestListenerWorkflow({
          connection: connection.slug,
          repository: repository.fullName,
          pullNumber,
        }).replaceAll(RUNNER_LABEL_PLACEHOLDER, runnerLabel),
      },
    });
    const runId = await fireManualAndAwaitRun({
      client,
      definitionId: definition.id,
      inputs: {},
      scenario: 'github-pull-request-events',
    });
    await waitForListenerStatus({
      token: session.token,
      runId,
      jobKey: LISTENER_JOB,
      listenerStatus: 'listening',
      timeoutMs: LISTENER_TIMEOUT_MS,
      runner: localRunner.runner,
    });

    const comment = await githubApi.sendPullRequestReviewComment({
      pullNumber,
      body: REVIEW_COMMENT,
      path: 'src/report.ts',
    });
    const executed = await waitForListenerExecution({
      token: session.token,
      runId,
      jobKey: LISTENER_JOB,
      sequence: 1,
      status: 'succeeded',
      includeContext: true,
      timeoutMs: LISTENER_TIMEOUT_MS,
    });
    const execution = executed.jobs
      .find((job) => job.key === LISTENER_JOB)
      ?.executions.find((candidate) => candidate.sequence === 1);
    expect(execution?.trigger_events.map((event) => event.delivery_id)).toEqual([
      comment.deliveryId,
    ]);
    expect(execution?.trigger_events[0]?.event).toBe('pull_request_review_comment.created');
    const withSteps = await observeRun({
      runId,
      token: session.token,
      selection: {
        jobs: [
          {
            jobKey: LISTENER_JOB,
            executionSequences: [1],
            stepKeys: ['show_comment'],
          },
        ],
      },
    });
    const commentLogs = await stepLogText({
      observation: withSteps,
      token: session.token,
      jobKey: LISTENER_JOB,
      sequence: 1,
      stepKey: 'show_comment',
    });
    expect(commentLogs).toContain(`comment_body=${REVIEW_COMMENT}`);
    expect(commentLogs).toContain('comment_path=src/report.ts');
    expect(commentLogs).toContain('comment_author=e2e-reviewer');

    await githubApi.sendPullRequestClosed({pullNumber, merged: true});
    await waitForListenerResolution({
      token: session.token,
      runId,
      jobKey: LISTENER_JOB,
      status: 'succeeded',
      reason: 'until',
      timeoutMs: LISTENER_TIMEOUT_MS,
    });
    const terminal = await waitForRunTerminalOrFailedRunner({
      runId,
      token: session.token,
      timeoutMs: RUN_TIMEOUT_MS,
      runner: localRunner.runner,
      selection: {jobs: [{jobKey: LISTENER_JOB, executionSequences: 'all'}]},
    });

    expect(terminal.status).toBe('succeeded');
    const listen = terminal.jobs.find((job) => job.key === LISTENER_JOB);
    expect(listen?.listener_status).toBe('resolved');
    expect(listen?.execution_count).toBe(1);
    expect(githubApi.pullRequests.get(pullNumber)).toMatchObject({state: 'closed', merged: true});
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
