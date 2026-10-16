import {readFile} from 'node:fs/promises';
import {createApiClient} from '@shipfox/e2e-core';
import {stopLocalRunner} from '@shipfox/e2e-driver-runner-process';
import {fetchStepLogs} from '@shipfox/e2e-observe-logs';
import type {WorkflowRunObservation, WorkflowStepObservation} from '@shipfox/e2e-observe-workflows';
import {
  getScriptedManagedProviderRequests,
  registerScriptedManagedProvider,
} from '@shipfox/e2e-setup-agent';
import {createSecret} from '@shipfox/e2e-setup-secrets';
import {attachLocalRunnerLog} from '#attachments.js';
import {logText} from '#expect.js';
import {startSuiteLocalRunner, waitForRunTerminalOrFailedRunner} from '#runner.js';
import {fireManualAndAwaitRun} from '#triggers.js';
import {seedAndWaitForDefinition} from '#workflow-project.js';
import {expect, test} from './fixtures.js';

const NAME = 'composite-action';
const JOB = 'composite';
const TERMINAL_TIMEOUT_MS = 180_000;
const SECRET_ACTOR_ID = '11111111-1111-4111-8111-111111111111';
const ACTION_DIR = '.shipfox/actions/review-kit';
const FIXTURE_DIR = new URL('../fixtures/composite-action/', import.meta.url);
const ACTION_FILES = ['action.yml', 'scripts/prepare.sh', 'prompts/review.txt'];
const ISSUE = {title: 'Composite tool fixture', body: 'Read this issue from a composite action.'};
const PROMPT_RULES = 'Composite review rules: reply with exactly the word ok.';
const INNER_STEPS = {
  greet: 'action',
  use_token: 'run',
  read_issue: 'tool',
  prepare: 'run',
  check: 'run',
  review: 'agent',
} as const;

test('runs a local composite action with nested, secret, tool, restarted, and agent steps', async ({
  suite,
}, testInfo) => {
  const uniqueId = crypto.randomUUID().replaceAll('-', '').slice(0, 10);
  const secretKey = `COMPOSITE_TOKEN_${uniqueId.toUpperCase()}`;
  const secretValue = `composite-secret-${uniqueId}`;
  const runnerLabel = `e2e-${NAME}-${uniqueId}`;
  const token = suite.sessionToken;
  const localRunner = await startSuiteLocalRunner({
    workspaceId: suite.workspaceId,
    userToken: token,
    name: `E2E ${NAME} ${uniqueId}`,
    runnerLabel,
    extraEnv: {SHIPFOX_POLL_MAX_DURATION_MS: String(TERMINAL_TIMEOUT_MS)},
  });

  try {
    // Only a definition sync snapshots actions and reads prompt files.
    const seeded = await seedAndWaitForDefinition({
      suite,
      token,
      name: NAME,
      repo: `${NAME}-${uniqueId}`,
      runnerLabel,
      workflowYaml: compositeWorkflow(secretKey),
      configPath: `.shipfox/workflows/${NAME}.yml`,
      extraFiles: await actionFiles(),
      giteaIssue: ISSUE,
    });
    await createSecret({
      workspaceId: suite.workspaceId,
      actorId: SECRET_ACTOR_ID,
      projectId: seeded.project.id,
      key: secretKey,
      value: secretValue,
    });
    await registerScriptedManagedProvider({
      projectId: seeded.project.id,
      entries: [{match: {prompt_contains: PROMPT_RULES}, replies: [{text: 'ok'}]}],
    });
    const runId = await fireManualAndAwaitRun({
      client: createApiClient({token}),
      definitionId: seeded.definition.id,
      inputs: {},
      scenario: NAME,
    });

    const terminal = await waitForRunTerminalOrFailedRunner({
      runId,
      token,
      timeoutMs: TERMINAL_TIMEOUT_MS,
      runner: localRunner.runner,
      selection: {
        jobs: [
          {
            jobKey: JOB,
            includeDefaultExecution: true,
            stepKeys: ['kit', ...Object.keys(INNER_STEPS), 'consume'],
            stepAttempts: 'all',
          },
        ],
      },
    });

    expect(terminal.status).toBe('succeeded');
    const kit = jobStep(terminal, 'kit');
    expect(kit).toMatchObject({type: 'composite', status: 'succeeded', parent_step_id: null});
    expect(kit.outputs).toEqual({greeting: 'Hello, Shipfox!', issue_title: ISSUE.title});
    for (const [key, type] of Object.entries(INNER_STEPS)) {
      expect(jobStep(terminal, key), key).toMatchObject({
        type,
        status: 'succeeded',
        parent_step_id: kit.id,
      });
    }
    const consume = jobStep(terminal, 'consume');
    expect(consume).toMatchObject({status: 'succeeded', parent_step_id: null});
    expect(await stepLogs(consume, token)).toContain(
      `composite outputs consumed: Hello, Shipfox! / ${ISSUE.title}`,
    );

    // The nested registry action ran its signed bundle.
    expect(await stepLogs(jobStep(terminal, 'greet'), token)).toContain('Hello, Shipfox!');

    // The secret input reached the inner run step and is masked in its log and the runner log.
    const tokenLogs = await stepLogs(jobStep(terminal, 'use_token'), token);
    expect(tokenLogs).toContain('token=***');
    expect(tokenLogs).not.toContain(secretValue);
    expect(await readFile(localRunner.logFile, 'utf8')).not.toContain(secretValue);

    // The tool step called the caller's connection through the action's alias.
    expect(jobStep(terminal, 'read_issue').outputs).toMatchObject({title: ISSUE.title});

    // The check gate failed once and restarted the composite from its inner prepare step,
    // which runs a script from the action directory.
    const prepare = jobStep(terminal, 'prepare');
    const check = jobStep(terminal, 'check');
    expect(prepare.current_attempt).toBe(2);
    expect(check.current_attempt).toBe(2);
    expect(check.attempts.find((attempt) => attempt.attempt === 1)?.gate_result).toMatchObject({
      kind: 'failed',
    });
    const prepareLogs = await stepLogs(prepare, token);
    expect(prepareLogs).toContain('prepare rerun after restart');
    expect(prepareLogs).toContain('prepare ran prepare.sh from the action directory');
    expect(await stepLogs(check, token)).toContain('check passes after restart');

    // The agent prompt joined the file the action shipped, read at sync, with the inline part.
    const review = jobStep(terminal, 'review');
    expect(currentAttempt(review)?.authored_config?.prompt).toBe(
      `${PROMPT_RULES}\n\nReview the change.`,
    );
    const requests = await getScriptedManagedProviderRequests({projectId: seeded.project.id});
    expect(requests).toHaveLength(1);
    expect(requests.every((request) => !request.surprise)).toBe(true);
  } finally {
    await attachLocalRunnerLog(
      (attachment) =>
        testInfo.attach(attachment.name, {
          body: attachment.body,
          contentType: attachment.contentType,
        }),
      localRunner.logFile,
    );
    await stopLocalRunner(localRunner.runner).catch(() => undefined);
  }
});

async function actionFiles(): Promise<Array<{path: string; content: string}>> {
  return await Promise.all(
    ACTION_FILES.map(async (file) => ({
      path: `${ACTION_DIR}/${file}`,
      content: await readFile(new URL(file, FIXTURE_DIR), 'utf8'),
    })),
  );
}

function compositeWorkflow(secretKey: string): string {
  return `
name: Composite action
runner: __RUNNER_LABEL__
triggers:
  manual:
    source: manual
jobs:
  ${JOB}:
    steps:
      - key: kit
        name: Run the review kit
        uses: ./${ACTION_DIR}
        connections:
          tracker: __GITEA_SOURCE__
        with:
          name: Shipfox
          repo: __GITEA_REPOSITORY_NAME__
          issue: __GITEA_ISSUE_NUMBER__
          token: \${{ secrets.${secretKey} }}
      - key: consume
        env:
          GREETING: \${{ steps.kit.outputs.greeting }}
          TITLE: \${{ steps.kit.outputs.issue_title }}
        run: |
          echo "composite outputs consumed: $GREETING / $TITLE"
`;
}

function jobStep(run: WorkflowRunObservation, key: string): WorkflowStepObservation {
  const step = run.jobs
    .find((job) => job.key === JOB)
    ?.executions.flatMap((execution) => execution.steps)
    .find((candidate) => candidate.key === key);
  if (step === undefined) throw new Error(`Step ${JOB}.${key} missing from observation`);
  return step;
}

function currentAttempt(step: WorkflowStepObservation) {
  return step.attempt_details.find((detail) => detail.attempt === step.current_attempt);
}

async function stepLogs(step: WorkflowStepObservation, token: string): Promise<string> {
  const logs = await fetchStepLogs({stepId: step.id, attempt: step.current_attempt, token});
  return logText(logs.records);
}
