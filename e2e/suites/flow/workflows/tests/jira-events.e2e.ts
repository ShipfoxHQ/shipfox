import {stopLocalRunner} from '@shipfox/e2e-driver-runner-process';
import {createJiraConnection} from '@shipfox/e2e-setup-integrations';
import {attachLocalRunnerLog} from '#attachments.js';
import {triggerJiraIssueEventAndAwaitRun} from '#jira-events.js';
import {startSuiteLocalRunner, waitForRunTerminalOrFailedRunner} from '#runner.js';
import {seedProjectWithApiDefinition} from '#workflow-project.js';
import {expect, test} from './fixtures.js';

const TERMINAL_TIMEOUT_MS = 60_000;

test('starts runs from signed Jira issue created and updated deliveries', async ({
  suite,
}, testInfo) => {
  const uniqueId = crypto.randomUUID().replaceAll('-', '').slice(0, 10);
  const scenario = 'jira-events';
  const token = suite.sessionToken;
  const runnerLabel = `e2e-${scenario}-${uniqueId}`;
  const cloudId = `cloud-${uniqueId}`;
  const webhookId = Math.floor(Math.random() * 900_000) + 100_000;
  const issues = {
    created: {
      id: `created-${uniqueId}`,
      key: 'ENG-2729',
      summary: 'Start runs from Jira created events',
      statusName: 'To Do',
    },
    updated: {
      id: `updated-${uniqueId}`,
      key: 'ENG-2730',
      summary: 'Start runs from Jira updated events',
      statusName: 'In Progress',
    },
  };
  const connection = await createJiraConnection({
    workspaceId: suite.workspaceId,
    cloudId,
    siteUrl: `https://${cloudId}.atlassian.example.test`,
    siteName: `E2E Jira ${uniqueId}`,
    authorizingAccountId: `authorizing-account-${uniqueId}`,
    displayName: `Jira E2E ${uniqueId}`,
    accessToken: `jira-e2e-token-${uniqueId}`,
    webhookIds: [webhookId],
  });
  const localRunner = await startSuiteLocalRunner({
    workspaceId: suite.workspaceId,
    userToken: token,
    name: `E2E ${scenario} ${uniqueId}`,
    runnerLabel,
    extraEnv: {SHIPFOX_POLL_MAX_DURATION_MS: String(TERMINAL_TIMEOUT_MS)},
  });

  try {
    // Each trigger filters on this test's own issue IDs, so a run proves both the event name and
    // that the raw provider payload reached the filter.
    const {project} = await seedProjectWithApiDefinition({
      suite,
      token,
      name: scenario,
      repo: `${scenario}-${uniqueId}`,
      runnerLabel,
      workflowYaml: jiraEventsWorkflowYaml({
        createdIssueId: issues.created.id,
        updatedIssueId: issues.updated.id,
      }),
      configPath: `.shipfox/workflows/${scenario}.yml`,
      replacements: {__JIRA_SOURCE__: connection.slug},
    });
    const common = {
      connectionId: connection.id,
      projectId: project.id,
      workspaceId: suite.workspaceId,
      token,
      webhookId,
      actorAccountId: `jira-user-${uniqueId}`,
    };

    const created = await triggerJiraIssueEventAndAwaitRun({
      ...common,
      event: 'jira:issue_created',
      issue: issues.created,
    });
    const updated = await triggerJiraIssueEventAndAwaitRun({
      ...common,
      event: 'jira:issue_updated',
      issue: issues.updated,
      previousStatusName: 'To Do',
    });

    for (const {runId} of [created, updated]) {
      const terminal = await waitForRunTerminalOrFailedRunner({
        runId,
        token,
        timeoutMs: TERMINAL_TIMEOUT_MS,
        runner: localRunner.runner,
      });
      expect(terminal.status).toBe('succeeded');
    }
  } finally {
    await attachLocalRunnerLog(
      (attachment) =>
        testInfo.attach(attachment.name, {
          body: attachment.body,
          contentType: attachment.contentType,
        }),
      localRunner.logFile,
    );
    await stopLocalRunner(localRunner.runner).catch((error: unknown) => {
      process.stderr.write(`${scenario}-e2e: stopLocalRunner failed: ${String(error)}\n`);
    });
  }
});

function jiraEventsWorkflowYaml(params: {createdIssueId: string; updatedIssueId: string}): string {
  return `
name: Jira events
runner: __RUNNER_LABEL__
triggers:
  on_issue_created:
    source: __JIRA_SOURCE__
    event: jira:issue_created
    filter: 'event.issue.id == "${params.createdIssueId}"'
  on_issue_updated:
    source: __JIRA_SOURCE__
    event: jira:issue_updated
    filter: 'event.issue.id == "${params.updatedIssueId}"'
jobs:
  handle:
    steps:
      - key: show
        run: echo "jira_event_received"
`;
}
