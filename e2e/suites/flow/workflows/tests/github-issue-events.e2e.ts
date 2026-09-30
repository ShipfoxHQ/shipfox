import {mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import type {DefinitionResponseDto} from '@shipfox/api-definitions-dto';
import {createApiClient} from '@shipfox/e2e-core';
import {startGithubApiMock} from '@shipfox/e2e-driver-github';
import {stopLocalRunner} from '@shipfox/e2e-driver-runner-process';
import {waitForRunByDeliveryId} from '@shipfox/e2e-observe-workflows';
import {createSession, createUser} from '@shipfox/e2e-setup-auth';
import {createGithubConnection} from '@shipfox/e2e-setup-integrations';
import {createProject} from '@shipfox/e2e-setup-projects';
import {createWorkspace} from '@shipfox/e2e-setup-workspaces';
import {attachLocalRunnerLog} from '#attachments.js';
import {waitForDefinitionSyncTerminal} from '#polling.js';
import {startSuiteLocalRunner, waitForRunTerminalOrFailedRunner} from '#runner.js';
import {expect, test} from './fixtures.js';

const SYNC_TIMEOUT_MS = 60_000;
const RUN_LOOKUP_TIMEOUT_MS = 15_000;
const RUN_TIMEOUT_MS = 120_000;
const MAX_DELIVERY_ATTEMPTS = 8;
const RUNNER_LABEL_PLACEHOLDER = '__RUNNER_LABEL__';
const TRIGGER_LABEL = 'shipfox';
const ASSIGNEE = 'shipfox-bot';

// Both triggers copy the shape of ticket-to-pr's GitHub tracker, so the payloads the fake
// sends have to carry every field those filters and the run read.
function issueEventsWorkflow(params: {
  connection: string;
  repository: string;
  labeledNumber: number;
  assignedNumber: number;
}): string {
  const {connection, repository, labeledNumber, assignedNumber} = params;
  const [owner, repo] = repository.split('/');
  return `
name: GitHub issue events
runner: ${RUNNER_LABEL_PLACEHOLDER}
triggers:
  on_issue_labeled:
    source: ${connection}
    event: issues.labeled
    filter: >-
      event.repository.full_name == "${repository}" &&
      event.issue.state == "open" &&
      event.issue.number == ${labeledNumber} &&
      event.label.name == "${TRIGGER_LABEL}"
  on_issue_assigned:
    source: ${connection}
    event: issues.assigned
    filter: >-
      event.repository.full_name == "${repository}" &&
      event.issue.state == "open" &&
      event.issue.number == ${assignedNumber} &&
      event.assignee.login == "${ASSIGNEE}"
jobs:
  acknowledge:
    checkout: false
    steps:
      - key: comment
        tool: add_issue_comment
        connection: ${connection}
        with:
          owner: ${owner}
          repo: ${repo}
          issue_number: \${{ int(event.issue.number) }}
          body: 'Shipfox picked up "\${{ event.issue.title }}".'
`;
}

// A delivery that lands before the definition's subscription activates starts no run, so the
// sender retries until one appears.
async function deliverAndAwaitRun(params: {
  send: () => Promise<{deliveryId: string}>;
  projectId: string;
  workspaceId: string;
  token: string;
}): Promise<string> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_DELIVERY_ATTEMPTS; attempt += 1) {
    const {deliveryId} = await params.send();
    try {
      const run = await waitForRunByDeliveryId({
        projectId: params.projectId,
        workspaceId: params.workspaceId,
        deliveryId,
        token: params.token,
        timeoutMs: RUN_LOOKUP_TIMEOUT_MS,
      });
      return run.id;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error(`No run appeared after ${MAX_DELIVERY_ATTEMPTS} signed GitHub deliveries.`);
}

test('starts runs from labeled and assigned issues and records the comment each run posts', async ({
  suite,
}, testInfo) => {
  const uniqueId = crypto.randomUUID().replaceAll('-', '').slice(0, 10);
  const installationId = Number.parseInt(uniqueId.slice(0, 7), 16) + 1;
  const installationToken = `ghs_${uniqueId}.${'e'.repeat(36)}.${'f'.repeat(36)}`;
  const githubApi = await startGithubApiMock({installationId, installationToken});
  const seedDirectory = await mkdtemp(join(tmpdir(), 'github-issue-events-e2e-'));
  const runnerLabel = `e2e-github-issue-events-${uniqueId}`;
  let stopRunner: (() => Promise<void>) | undefined;
  let runnerLogFile: string | undefined;
  try {
    await writeFile(join(seedDirectory, 'README.md'), '# report-cli\n');
    const repository = await githubApi.addRepository({
      owner: 'acme',
      name: `report-cli-${uniqueId}`,
      seedDirectory,
    });
    const labeledNumber = 5;
    const assignedNumber = 6;
    githubApi.issues.set(labeledNumber, {
      repository: repository.fullName,
      title: 'Add a --json flag to the report command',
      body: 'Print the report as JSON.',
      labels: ['enhancement'],
    });
    githubApi.issues.set(assignedNumber, {
      repository: repository.fullName,
      title: 'Fix the report header',
    });

    // A GitHub connection resyncs every project in its workspace when it becomes available, so
    // this test gets a workspace of its own.
    const user = await createUser({name: `GitHub issues ${uniqueId}`});
    const workspace = await createWorkspace({
      userId: user.user.id,
      userEmail: user.email,
      name: `GitHub issues ${suite.runId} ${uniqueId}`,
    });
    const session = await createSession({user_id: user.user.id});
    const client = createApiClient({token: session.token});
    const connection = await createGithubConnection({
      workspaceId: workspace.id,
      installationId,
      accountLogin: repository.owner,
      displayName: `GitHub issues ${uniqueId}`,
      installerUserId: crypto.randomUUID(),
      lifecycleStatus: 'disabled',
    });
    await client.request('patch', `/integration-connections/${connection.id}`, {
      json: {lifecycle_status: 'active'},
    });
    const project = await createProject({
      workspaceId: workspace.id,
      name: `GitHub issues project ${uniqueId}`,
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
      name: `E2E GitHub issues ${uniqueId}`,
      runnerLabel,
    });
    runnerLogFile = localRunner.logFile;
    stopRunner = () => stopLocalRunner(localRunner.runner).catch(() => undefined);
    await client.requestJson<DefinitionResponseDto>('post', '/definitions', {
      json: {
        project_id: project.id,
        source: 'manual',
        yaml: issueEventsWorkflow({
          connection: connection.slug,
          repository: repository.fullName,
          labeledNumber,
          assignedNumber,
        }).replaceAll(RUNNER_LABEL_PLACEHOLDER, runnerLabel),
      },
    });

    const delivery = {projectId: project.id, workspaceId: workspace.id, token: session.token};
    const labeledRunId = await deliverAndAwaitRun({
      ...delivery,
      send: () => githubApi.sendIssueLabeled({issueNumber: labeledNumber, label: TRIGGER_LABEL}),
    });
    const assignedRunId = await deliverAndAwaitRun({
      ...delivery,
      send: () => githubApi.sendIssueAssigned({issueNumber: assignedNumber, assignee: ASSIGNEE}),
    });

    for (const runId of [labeledRunId, assignedRunId]) {
      const terminal = await waitForRunTerminalOrFailedRunner({
        runId,
        token: session.token,
        timeoutMs: RUN_TIMEOUT_MS,
        runner: localRunner.runner,
      });
      expect(terminal.status).toBe('succeeded');
    }
    expect(githubApi.writes()).toEqual(
      expect.arrayContaining([
        {
          kind: 'github.create_issue_comment',
          target: `${repository.fullName}#${labeledNumber}`,
          payload: {body: 'Shipfox picked up "Add a --json flag to the report command".'},
        },
        {
          kind: 'github.create_issue_comment',
          target: `${repository.fullName}#${assignedNumber}`,
          payload: {body: 'Shipfox picked up "Fix the report header".'},
        },
      ]),
    );
    expect(githubApi.issues.get(labeledNumber)).toMatchObject({
      labels: ['enhancement', TRIGGER_LABEL],
    });
    expect(githubApi.issues.get(assignedNumber)).toMatchObject({assignees: [ASSIGNEE]});
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
