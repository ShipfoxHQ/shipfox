import type {WorkflowRunDetailResponseDto} from '@shipfox/api-workflows-dto';
import {createApiClient} from '@shipfox/e2e-core';
import {stopLocalRunner} from '@shipfox/e2e-driver-runner-process';
import {
  createAnthropicModelProviderConfig,
  createOllamaCustomProvider,
  deleteModelProviderConfig,
  type OllamaConfig,
  requireOllamaModel,
} from '@shipfox/e2e-setup-agent';
import {attachLocalRunnerLog} from '#attachments.js';
import {startSuiteLocalRunner, waitForRunTerminalOrFailedRunner} from '#runner.js';
import type {SuiteContext} from '#suite-context.js';
import {fireManualAndAwaitRun} from '#triggers.js';
import {seedAndWaitForDefinition} from '#workflow-project.js';
import {expect, test} from './fixtures.js';

const CLAUDE_CONFIG_MODEL = 'claude-opus-4-8';
const OLLAMA_SMOKE_MAX_OUTPUT_TOKENS = 64;

test.describe.configure({mode: 'serial'});

test('runs a Claude harness smoke workflow against local Ollama', async ({suite}, testInfo) => {
  const ollama = await requireOllamaOrSkip();
  if (ollama === undefined) return;

  const uniqueId = crypto.randomUUID().replaceAll('-', '').slice(0, 10);
  await createAnthropicModelProviderConfig({
    workspaceId: suite.workspaceId,
    defaultModel: CLAUDE_CONFIG_MODEL,
  });

  const terminal = await runLiveOllamaWorkflow({
    suite,
    testInfo,
    uniqueId,
    scenario: 'claude-ollama-agent',
    workflowYaml: workflowYaml({
      name: 'Claude Ollama agent',
      harness: 'claude',
      thinking: 'low',
      provider: 'anthropic',
      model: CLAUDE_CONFIG_MODEL,
    }),
    runnerEnv: {
      AGENT_CLAUDE_ANTHROPIC_BASE_URL: ollama.baseUrl,
      AGENT_CLAUDE_ANTHROPIC_MODEL: ollama.model,
      AGENT_CLAUDE_ANTHROPIC_SMALL_FAST_MODEL: ollama.model,
    },
  });

  expect(terminal.status).toBe('succeeded');
  expect(terminal.jobs.find((job) => job.key === 'fix')?.status).toBe('succeeded');
  expect(stepResponse(terminal, 'fix', 'reply').trim().length).toBeGreaterThan(0);
});

test('runs a Pi harness smoke workflow against local Ollama', async ({suite}, testInfo) => {
  const ollama = await requireOllamaOrSkip();
  if (ollama === undefined) return;

  const uniqueId = crypto.randomUUID().replaceAll('-', '').slice(0, 10);
  const provider = await createOllamaCustomProvider({
    workspaceId: suite.workspaceId,
    sessionToken: suite.sessionToken,
    providerId: `local-ollama-smoke-${uniqueId}`,
    displayName: `Local Ollama Smoke ${uniqueId}`,
    baseUrl: ollama.baseUrl,
    model: ollama.model,
    modelMetadata: {max_output_tokens: OLLAMA_SMOKE_MAX_OUTPUT_TOKENS},
  });

  try {
    const terminal = await runLiveOllamaWorkflow({
      suite,
      testInfo,
      uniqueId,
      scenario: 'pi-ollama-agent',
      workflowYaml: workflowYaml({
        name: 'Pi Ollama agent',
        harness: 'pi',
        thinking: 'off',
        provider: provider.provider_id,
        model: ollama.model,
      }),
      runnerEnv: {},
    });

    expect(terminal.status).toBe('succeeded');
    expect(terminal.jobs.find((job) => job.key === 'fix')?.status).toBe('succeeded');
    expect(stepResponse(terminal, 'fix', 'reply').trim().length).toBeGreaterThan(0);
  } finally {
    await deleteModelProviderConfig({
      workspaceId: suite.workspaceId,
      sessionToken: suite.sessionToken,
      providerId: provider.provider_id,
    }).catch(() => undefined);
  }
});

async function requireOllamaOrSkip(): Promise<OllamaConfig | undefined> {
  try {
    return await requireOllamaModel();
  } catch (error) {
    test.skip(true, error instanceof Error ? error.message : String(error));
    return undefined;
  }
}

function workflowYaml(params: {
  name: string;
  harness: 'claude' | 'pi';
  thinking: 'low' | 'off';
  provider: string;
  model: string;
}): string {
  return `
name: ${params.name}
runner: __RUNNER_LABEL__
triggers:
  manual:
    source: manual
    event: fire
jobs:
  fix:
    steps:
      - key: reply
        harness: ${params.harness}
        provider: ${params.provider}
        model: ${params.model}
        thinking: ${params.thinking}
        prompt: |
          Reply with exactly the word: ok
          Do not include any other text.
`;
}

async function runLiveOllamaWorkflow(params: {
  suite: SuiteContext;
  testInfo: {
    attach: (name: string, options: {body: Buffer | string; contentType: string}) => Promise<void>;
  };
  uniqueId: string;
  scenario: string;
  workflowYaml: string;
  runnerEnv: Record<string, string>;
}): Promise<WorkflowRunDetailResponseDto> {
  const token = params.suite.sessionToken;
  const client = createApiClient({token});
  const runnerLabel = `e2e-${params.scenario}-${params.uniqueId}`;
  const repo = `${params.scenario}-${params.uniqueId}`;
  const localRunner = await startSuiteLocalRunner({
    workspaceId: params.suite.workspaceId,
    userToken: token,
    name: `E2E ${params.scenario} ${params.uniqueId}`,
    runnerLabel,
    extraEnv: params.runnerEnv,
  });

  try {
    const {definition} = await seedAndWaitForDefinition({
      suite: params.suite,
      token,
      name: params.scenario,
      repo,
      runnerLabel,
      workflowYaml: params.workflowYaml,
      configPath: `.shipfox/workflows/${params.scenario}.yml`,
    });

    const runId = await fireManualAndAwaitRun({
      client,
      definitionId: definition.id,
      inputs: {},
      scenario: params.scenario,
    });

    return await waitForRunTerminalOrFailedRunner({
      runId,
      token,
      timeoutMs: 300_000,
      runner: localRunner.runner,
    });
  } finally {
    await attachLocalRunnerLog(
      (attachment) =>
        params.testInfo.attach(attachment.name, {
          body: attachment.body,
          contentType: attachment.contentType,
        }),
      localRunner.logFile,
    );
    await stopLocalRunner(localRunner.runner).catch((error: unknown) => {
      process.stderr.write(`${params.scenario}-e2e: stopLocalRunner failed: ${String(error)}\n`);
    });
  }
}

function stepResponse(run: WorkflowRunDetailResponseDto, jobKey: string, stepKey: string): string {
  const step = run.jobs
    .find((job) => job.key === jobKey)
    ?.job_executions.flatMap((execution) => execution.steps)
    .find((candidate) => candidate.key === stepKey);
  if (step === undefined) throw new Error(`Step ${jobKey}.${stepKey} missing from run detail`);
  if (step.response === null)
    throw new Error(`Step ${jobKey}.${stepKey} did not record a response`);
  return step.response;
}
