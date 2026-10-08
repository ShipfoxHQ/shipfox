import {createApiClient} from '@shipfox/e2e-core';
import {stopLocalRunner} from '@shipfox/e2e-driver-runner-process';
import type {WorkflowRunObservation} from '@shipfox/e2e-observe-workflows';
import {
  getScriptedManagedProviderRequests,
  registerScriptedManagedProvider,
} from '@shipfox/e2e-setup-agent';
import {attachLocalRunnerLog} from '#attachments.js';
import {startSuiteLocalRunner, waitForRunTerminalOrFailedRunner} from '#runner.js';
import {fireManualAndAwaitRun} from '#triggers.js';
import {seedAndWaitForDefinition} from '#workflow-project.js';
import {expect, test} from './fixtures.js';

const TERMINAL_TIMEOUT_MS = 60_000;
const SCRIPTED_CATALOG_MODEL = 'gpt-6-luna';
const RULES_FILE = '.shipfox/prompts/rules.md';
// The trailing line breaks are part of the fixture: joining must drop them.
const RULES_TEXT = 'Follow the house rules.\nReply with exactly the word: ok\n\n';

test('joins a prompt file and an anchored string into the authored prompt', async ({
  suite,
}, testInfo) => {
  const uniqueId = crypto.randomUUID().replaceAll('-', '').slice(0, 10);
  const scenario = `prompt-files-${uniqueId}`;
  const runnerLabel = `e2e-${scenario}`;
  const token = suite.sessionToken;
  const localRunner = await startSuiteLocalRunner({
    workspaceId: suite.workspaceId,
    userToken: token,
    name: `E2E ${scenario}`,
    runnerLabel,
    extraEnv: {SHIPFOX_POLL_MAX_DURATION_MS: String(TERMINAL_TIMEOUT_MS)},
  });

  try {
    // Only a definition read from the repository can read prompt files.
    const seeded = await seedAndWaitForDefinition({
      suite,
      token,
      name: scenario,
      repo: scenario,
      runnerLabel,
      workflowYaml: promptFilesWorkflow(),
      configPath: `.shipfox/workflows/${scenario}.yml`,
      extraFiles: [{path: RULES_FILE, content: RULES_TEXT}],
    });
    await registerScriptedManagedProvider({
      projectId: seeded.project.id,
      entries: [
        {match: {prompt_contains: 'First task'}, replies: [{text: 'ok'}]},
        {match: {prompt_contains: 'Second task'}, replies: [{text: 'ok'}]},
      ],
    });
    const runId = await fireManualAndAwaitRun({
      client: createApiClient({token}),
      definitionId: seeded.definition.id,
      inputs: {},
      scenario,
    });
    const terminal = await waitForRunTerminalOrFailedRunner({
      runId,
      token,
      timeoutMs: TERMINAL_TIMEOUT_MS,
      runner: localRunner.runner,
      selection: {
        jobs: [{jobKey: 'review', includeDefaultExecution: true, stepKeys: ['first', 'second']}],
      },
    });

    expect(terminal.status).toBe('succeeded');
    expect(authoredPrompt(terminal, 'first')).toBe(
      'First task: say ok.\n\nDo not include any other text.',
    );
    expect(authoredPrompt(terminal, 'second')).toBe(
      'Follow the house rules.\nReply with exactly the word: ok\n\nSecond task: say ok.\n\nDo not include any other text.',
    );
    const requests = await getScriptedManagedProviderRequests({projectId: seeded.project.id});
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

function promptFilesWorkflow(): string {
  return `
name: Prompt files
runner: __RUNNER_LABEL__
triggers:
  manual:
    source: manual
    event: fire
jobs:
  review:
    steps:
      - key: first
        harness: pi
        provider: shipfox
        model: ${SCRIPTED_CATALOG_MODEL}
        thinking: off
        prompt:
          - 'First task: say ok.'
          - &closing |
            Do not include any other text.
      - key: second
        harness: pi
        provider: shipfox
        model: ${SCRIPTED_CATALOG_MODEL}
        thinking: off
        prompt:
          - file: ./${RULES_FILE}
          - 'Second task: say ok.'
          - *closing
`;
}

function authoredPrompt(run: WorkflowRunObservation, stepKey: string): unknown {
  const step = run.jobs
    .find((job) => job.key === 'review')
    ?.executions.flatMap((execution) => execution.steps)
    .find((candidate) => candidate.key === stepKey);
  if (step === undefined) throw new Error(`Step review.${stepKey} missing from observation`);
  return step.attempt_details.find((detail) => detail.attempt === step.current_attempt)
    ?.authored_config?.prompt;
}
