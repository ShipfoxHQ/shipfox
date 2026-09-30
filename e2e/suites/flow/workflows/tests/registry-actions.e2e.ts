import {createApiClient} from '@shipfox/e2e-core';
import {stopLocalRunner} from '@shipfox/e2e-driver-runner-process';
import {fetchStepLogs} from '@shipfox/e2e-observe-logs';
import {logText} from '#expect.js';
import {readRegistryVersionDocument} from '#registry.js';
import {startSuiteLocalRunner, waitForRunTerminalOrFailedRunner} from '#runner.js';
import {fireManualAndAwaitRun} from '#triggers.js';
import {seedAndWaitForDefinition} from '#workflow-project.js';
import {expect, test} from './fixtures.js';

// The rejection and strict-loader cases are declarative scenarios: reject-registry-action-range
// and registry-action-workspace-import. This one compares the run with the registry's signed
// document, which only a spec can read.

const PACKAGE = 'fixture/example';
const VERSION = '1.0.0';
const NAME = 'registry-action';

const workflowYaml = `
name: Registry action
runner: __RUNNER_LABEL__
triggers:
  manual:
    source: manual
jobs:
  greet:
    steps:
      - key: greet
        uses: ${PACKAGE}@${VERSION}
        with:
          name: Shipfox
`;

test('a registry action runs the bundle the registry signed', async ({suite}) => {
  const token = suite.sessionToken;
  const uniqueId = crypto.randomUUID().replaceAll('-', '').slice(0, 10);
  const runnerLabel = `e2e-${NAME}-${uniqueId}`;
  const repo = `${NAME}-${uniqueId}`;
  const document = await readRegistryVersionDocument({
    package: PACKAGE,
    version: VERSION,
    kind: 'action',
  });
  const {runner} = await startSuiteLocalRunner({
    workspaceId: suite.workspaceId,
    userToken: token,
    name: `E2E ${NAME} ${uniqueId}`,
    runnerLabel,
  });
  try {
    // Only a definition sync resolves registry actions.
    const {definition} = await seedAndWaitForDefinition({
      suite,
      token,
      name: NAME,
      repo,
      runnerLabel,
      workflowYaml,
      configPath: `.shipfox/workflows/${NAME}.yml`,
    });
    const runId = await fireManualAndAwaitRun({
      client: createApiClient({token}),
      definitionId: definition.id,
      inputs: {},
      scenario: repo,
    });

    const observation = await waitForRunTerminalOrFailedRunner({
      runId,
      token,
      timeoutMs: 180_000,
      runner,
      selection: {jobs: [{jobKey: 'greet', includeDefaultExecution: true, stepKeys: ['greet']}]},
    });
    const step = observation.jobs
      .find((job) => job.key === 'greet')
      ?.executions.flatMap((execution) => execution.steps)
      .find((candidate) => candidate.key === 'greet');
    if (step === undefined) throw new Error('Step greet.greet is missing');
    const logs = logText(
      (await fetchStepLogs({stepId: step.id, attempt: step.current_attempt, token})).records,
    );

    expect(observation.status).toBe('succeeded');
    expect(step).toMatchObject({type: 'action', status: 'succeeded'});
    expect(step.outputs).toEqual({greeting: 'Hello, Shipfox!'});
    // The run page reads the reference from the step config.
    expect(step.attempt_details[0]?.config).toMatchObject({
      action: {
        uses: `${PACKAGE}@${VERSION}`,
        origin: 'registry',
        package: PACKAGE,
        version: VERSION,
        digest: document.content.digest,
      },
    });
    // The runner logs the digest it checked the bundle against before extracting it.
    expect(logs).toContain(`Shipfox action Example ${document.content.digest}`);
    expect(logs).toContain('Hello, Shipfox!');
  } finally {
    await stopLocalRunner(runner).catch(() => undefined);
  }
});
