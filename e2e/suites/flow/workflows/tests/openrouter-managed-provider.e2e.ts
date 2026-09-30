import {createApiClient} from '@shipfox/e2e-core';
import {stopLocalRunner} from '@shipfox/e2e-driver-runner-process';
import {registerOpenRouterManagedProvider} from '@shipfox/e2e-setup-agent';
import {attachLocalRunnerLog} from '#attachments.js';
import {startSuiteLocalRunner, waitForRunTerminalOrFailedRunner} from '#runner.js';
import {fireManualAndAwaitRun} from '#triggers.js';
import {seedAndWaitForDefinition} from '#workflow-project.js';
import {expect, test} from './fixtures.js';

const CATALOG_MODEL = 'glm-5.3-flash';
const TERMINAL_TIMEOUT_MS = 180_000;

interface RunUsageResponse {
  inference_segments: Array<{
    model: string;
    dialect: string;
    input_tokens: number;
    output_tokens: number;
  }>;
}

// Spends real money. Run it by hand with E2E_OPENROUTER_API_KEY set for the API and this suite.
test.skip(!process.env.E2E_OPENROUTER_API_KEY, 'Needs E2E_OPENROUTER_API_KEY to call OpenRouter');

test('runs a catalog Pi step through OpenRouter and records its tokens', async ({
  suite,
}, testInfo) => {
  const uniqueId = crypto.randomUUID().replaceAll('-', '').slice(0, 10);
  const scenario = `openrouter-managed-provider-${uniqueId}`;
  const runnerLabel = `e2e-${scenario}`;
  const token = suite.sessionToken;
  const client = createApiClient({token});
  const localRunner = await startSuiteLocalRunner({
    workspaceId: suite.workspaceId,
    userToken: token,
    name: `E2E ${scenario}`,
    runnerLabel,
    extraEnv: {SHIPFOX_POLL_MAX_DURATION_MS: String(TERMINAL_TIMEOUT_MS)},
  });

  try {
    const seeded = await seedAndWaitForDefinition({
      suite,
      token,
      name: scenario,
      repo: scenario,
      runnerLabel,
      workflowYaml: `
name: OpenRouter catalog model
runner: ${runnerLabel}
triggers:
  manual:
    source: manual
    event: fire
jobs:
  reply:
    steps:
      - key: answer
        harness: pi
        provider: shipfox
        model: ${CATALOG_MODEL}
        thinking: off
        prompt: Reply with a one-sentence greeting.
`,
      configPath: `.shipfox/workflows/${scenario}.yml`,
    });
    await registerOpenRouterManagedProvider({projectId: seeded.project.id});
    const runId = await fireManualAndAwaitRun({
      client,
      definitionId: seeded.definition.id,
      inputs: {},
      scenario,
    });
    const terminal = await waitForRunTerminalOrFailedRunner({
      runId,
      token,
      timeoutMs: TERMINAL_TIMEOUT_MS,
      runner: localRunner.runner,
    });

    expect(terminal.status).toBe('succeeded');
    const usage = await client.requestJson<RunUsageResponse>(
      'get',
      `/usage/workspaces/${suite.workspaceId}/runs/${runId}`,
    );
    const segments = usage.inference_segments.filter((segment) => segment.model === CATALOG_MODEL);
    expect(segments.length).toBeGreaterThan(0);
    expect(segments.every((segment) => segment.dialect === 'openai-completions')).toBe(true);
    expect(segments.reduce((total, segment) => total + segment.input_tokens, 0)).toBeGreaterThan(0);
    expect(segments.reduce((total, segment) => total + segment.output_tokens, 0)).toBeGreaterThan(
      0,
    );
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
