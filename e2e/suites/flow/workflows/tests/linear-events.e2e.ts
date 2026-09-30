import {stopLocalRunner} from '@shipfox/e2e-driver-runner-process';
import {createLinearConnection} from '@shipfox/e2e-setup-integrations';
import {attachLocalRunnerLog} from '#attachments.js';
import {
  triggerLinearAgentSessionAndAwaitRun,
  triggerLinearIssueUpdateAndAwaitRun,
} from '#linear-events.js';
import {startSuiteLocalRunner, waitForRunTerminalOrFailedRunner} from '#runner.js';
import {seedProjectWithApiDefinition} from '#workflow-project.js';
import {expect, test} from './fixtures.js';

const TERMINAL_TIMEOUT_MS = 60_000;

test('starts runs from signed Linear issue update and agent session deliveries', async ({
  suite,
}, testInfo) => {
  const uniqueId = crypto.randomUUID().replaceAll('-', '').slice(0, 10);
  const scenario = 'linear-events';
  const token = suite.sessionToken;
  const runnerLabel = `e2e-${scenario}-${uniqueId}`;
  const organizationId = `linear-org-${uniqueId}`;
  const appUserId = `linear-app-user-${uniqueId}`;
  const issue = {
    id: `issue-${uniqueId}`,
    identifier: 'ENG-2716',
    title: 'Start runs from Linear events',
    teamId: `team-${uniqueId}`,
    stateId: `state-done-${uniqueId}`,
  };
  const sessionIds = {
    created: `session-created-${uniqueId}`,
    prompted: `session-prompted-${uniqueId}`,
  };
  const connection = await createLinearConnection({
    workspaceId: suite.workspaceId,
    organizationId,
    organizationUrlKey: `e2e-${uniqueId}`,
    appUserId,
    displayName: `Linear E2E ${uniqueId}`,
    accessToken: `linear-e2e-token-${uniqueId}`,
  });
  const localRunner = await startSuiteLocalRunner({
    workspaceId: suite.workspaceId,
    userToken: token,
    name: `E2E ${scenario} ${uniqueId}`,
    runnerLabel,
    extraEnv: {SHIPFOX_POLL_MAX_DURATION_MS: String(TERMINAL_TIMEOUT_MS)},
  });

  try {
    // Each trigger filters on this test's own IDs, so a run proves both the event name and
    // that the raw provider payload reached the filter.
    const {project} = await seedProjectWithApiDefinition({
      suite,
      token,
      name: scenario,
      repo: `${scenario}-${uniqueId}`,
      runnerLabel,
      workflowYaml: linearEventsWorkflowYaml({
        issueId: issue.id,
        createdSessionId: sessionIds.created,
        promptedSessionId: sessionIds.prompted,
      }),
      configPath: `.shipfox/workflows/${scenario}.yml`,
      replacements: {__LINEAR_SOURCE__: connection.slug},
    });
    const common = {
      projectId: project.id,
      workspaceId: suite.workspaceId,
      token,
      organizationId,
      issue,
    };

    const issueUpdate = await triggerLinearIssueUpdateAndAwaitRun({
      ...common,
      previousStateId: `state-todo-${uniqueId}`,
      actorId: `linear-user-${uniqueId}`,
    });
    const sessionCreated = await triggerLinearAgentSessionAndAwaitRun({
      ...common,
      action: 'created',
      appUserId,
      sessionId: sessionIds.created,
    });
    const sessionPrompted = await triggerLinearAgentSessionAndAwaitRun({
      ...common,
      action: 'prompted',
      appUserId,
      sessionId: sessionIds.prompted,
      prompt: 'Also update the changelog.',
    });

    for (const {runId} of [issueUpdate, sessionCreated, sessionPrompted]) {
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

function linearEventsWorkflowYaml(params: {
  issueId: string;
  createdSessionId: string;
  promptedSessionId: string;
}): string {
  return `
name: Linear events
runner: __RUNNER_LABEL__
triggers:
  on_issue_update:
    source: __LINEAR_SOURCE__
    event: Issue.update
    filter: 'event.data.id == "${params.issueId}"'
  on_session_created:
    source: __LINEAR_SOURCE__
    event: agentSession.created
    filter: 'event.agentSession.id == "${params.createdSessionId}"'
  on_session_prompted:
    source: __LINEAR_SOURCE__
    event: agentSession.prompted
    filter: 'event.agentSession.id == "${params.promptedSessionId}"'
jobs:
  handle:
    steps:
      - key: show
        run: echo "linear_event_received"
`;
}
