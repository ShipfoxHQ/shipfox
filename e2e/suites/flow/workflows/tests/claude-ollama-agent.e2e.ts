import {createApiClient} from '@shipfox/e2e-core';
import {stopLocalRunner} from '@shipfox/e2e-driver-runner-process';
import {
  createAnthropicModelProviderConfig,
  type ollamaConfig,
  requireOllamaModel,
} from '@shipfox/e2e-setup-agent';
import {attachLocalRunnerLog} from '#attachments.js';
import {startSuiteLocalRunner, waitForRunTerminalOrFailedRunner} from '#runner.js';
import {fireManualAndAwaitRun} from '#triggers.js';
import {seedAndWaitForDefinition} from '#workflow-project.js';
import {expect, test} from './fixtures.js';

const WORKFLOW_YAML = `
name: Claude Ollama agent
runner: __RUNNER_LABEL__
triggers:
  manual:
    source: manual
    event: fire
jobs:
  fix:
    steps:
      - key: reply
        harness: claude
        thinking: low
        prompt: 'Reply with exactly: ok'
`;

test('runs a Claude harness step against local Ollama', async ({suite}, testInfo) => {
  let ollama: ReturnType<typeof ollamaConfig>;
  try {
    ollama = await requireOllamaModel();
  } catch (error) {
    test.skip(true, error instanceof Error ? error.message : String(error));
    return;
  }

  const token = suite.sessionToken;
  const client = createApiClient({token});
  const uniqueId = crypto.randomUUID().replaceAll('-', '').slice(0, 10);
  const runnerLabel = `e2e-claude-ollama-${uniqueId}`;
  const repo = `claude-ollama-${uniqueId}`;
  await createAnthropicModelProviderConfig({
    workspaceId: suite.workspaceId,
    defaultModel: 'claude-opus-4-8',
    setAsDefault: true,
  });
  const localRunner = await startSuiteLocalRunner({
    workspaceId: suite.workspaceId,
    userToken: token,
    name: `E2E Claude Ollama ${uniqueId}`,
    runnerLabel,
    extraEnv: {
      AGENT_CLAUDE_ANTHROPIC_BASE_URL: ollama.baseUrl,
      AGENT_CLAUDE_ANTHROPIC_MODEL: ollama.model,
      AGENT_CLAUDE_ANTHROPIC_SMALL_FAST_MODEL: ollama.model,
    },
  });

  try {
    const {definition} = await seedAndWaitForDefinition({
      suite,
      token,
      name: 'claude-ollama-agent',
      repo,
      runnerLabel,
      workflowYaml: WORKFLOW_YAML,
      configPath: '.shipfox/workflows/claude-ollama-agent.yml',
    });

    const runId = await fireManualAndAwaitRun({
      client,
      definitionId: definition.id,
      inputs: {},
      scenario: 'claude-ollama-agent',
    });
    const terminal = await waitForRunTerminalOrFailedRunner({
      runId,
      token,
      timeoutMs: 180_000,
      runner: localRunner.runner,
    });

    expect(terminal.status).toBe('succeeded');
    expect(terminal.jobs.find((job) => job.key === 'fix')?.status).toBe('succeeded');
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
      process.stderr.write(`claude-ollama-agent-e2e: stopLocalRunner failed: ${String(error)}\n`);
    });
  }
});
