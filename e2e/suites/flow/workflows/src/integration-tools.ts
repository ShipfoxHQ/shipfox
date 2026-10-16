import {createApiClient} from '@shipfox/e2e-core';
import {type LocalRunnerHandle, stopLocalRunner} from '@shipfox/e2e-driver-runner-process';
import type {SuiteContext} from '@shipfox/e2e-kit/suite-context';
import type {WorkflowRunObservation} from '@shipfox/e2e-observe-workflows';
import {attachLocalRunnerLog} from '#attachments.js';
import {startSuiteLocalRunner, waitForRunTerminalOrFailedRunner} from '#runner.js';
import {fireManualAndAwaitRun} from '#triggers.js';
import {seedProjectWithApiDefinition} from '#workflow-project.js';

// The helpers of the integration agent-tools specs: a local runner, manual workflows that run on
// it, and the lifecycle status of a connection.

const TERMINAL_TIMEOUT_MS = 60_000;

export type AttachFn = (
  name: string,
  options: {body: Buffer | string; contentType: string},
) => Promise<void>;

export interface IntegrationToolsRunner {
  runner: LocalRunnerHandle;
  runnerLabel: string;
  /** Attaches the runner log, then stops the runner. Never throws. */
  stop(attach: AttachFn): Promise<void>;
}

export interface IntegrationToolsWorkflow {
  /** Fires the workflow and waits for the run to end. A second call fires it again. */
  run(): Promise<WorkflowRunObservation>;
}

/**
 * A local runner for manual workflows. Several workflows can share it, so a spec boots one runner
 * for all its tests. `extraEnv` holds what every run on it needs, such as a fake model provider.
 */
export async function startIntegrationToolsRunner(params: {
  suite: SuiteContext;
  name: string;
  uniqueId: string;
  extraEnv?: Record<string, string> | undefined;
}): Promise<IntegrationToolsRunner> {
  const runnerLabel = `e2e-${params.name}-${params.uniqueId}`;
  const {runner, logFile} = await startSuiteLocalRunner({
    workspaceId: params.suite.workspaceId,
    userToken: params.suite.sessionToken,
    name: `E2E ${params.name} ${params.uniqueId}`,
    runnerLabel,
    extraEnv: {
      ...params.extraEnv,
      SHIPFOX_POLL_MAX_DURATION_MS: String(TERMINAL_TIMEOUT_MS),
    },
  });
  return {
    runner,
    runnerLabel,
    stop: async (attach) => {
      await attachLocalRunnerLog(
        (attachment) =>
          attach(attachment.name, {body: attachment.body, contentType: attachment.contentType}),
        logFile,
      ).catch(() => undefined);
      await stopLocalRunner(runner).catch(() => undefined);
    },
  };
}

/** A manual workflow in a project of its own, whose jobs run on `runner`. */
export async function defineIntegrationToolsWorkflow(params: {
  suite: SuiteContext;
  runner: IntegrationToolsRunner;
  name: string;
  uniqueId: string;
  workflowYaml: string;
}): Promise<IntegrationToolsWorkflow> {
  const {suite, runner} = params;
  const client = createApiClient({token: suite.sessionToken});
  const {definition} = await seedProjectWithApiDefinition({
    suite,
    token: suite.sessionToken,
    name: params.name,
    repo: `${params.name}-${params.uniqueId}`,
    runnerLabel: runner.runnerLabel,
    workflowYaml: params.workflowYaml,
    configPath: `.shipfox/workflows/${params.name}.yml`,
  });
  let runCount = 0;
  return {
    run: async () => {
      runCount += 1;
      const runId = await fireManualAndAwaitRun({
        client,
        definitionId: definition.id,
        inputs: {},
        scenario: `${params.name}-${runCount}`,
      });
      return await waitForRunTerminalOrFailedRunner({
        runId,
        token: suite.sessionToken,
        timeoutMs: TERMINAL_TIMEOUT_MS,
        runner: runner.runner,
      });
    },
  };
}

/**
 * A runner of its own and one workflow on it, for a test whose runner needs an environment no
 * other test shares. `stop` attaches the runner log to the test.
 */
export async function startIntegrationToolsScenario(params: {
  suite: SuiteContext;
  testInfo: {attach: AttachFn};
  uniqueId: string;
  name: string;
  workflowYaml: string;
  extraEnv?: Record<string, string> | undefined;
}): Promise<IntegrationToolsWorkflow & {stop(): Promise<void>}> {
  const runner = await startIntegrationToolsRunner(params);
  const stop = () => runner.stop((name, options) => params.testInfo.attach(name, options));
  try {
    const workflow = await defineIntegrationToolsWorkflow({...params, runner});
    return {run: workflow.run, stop};
  } catch (error) {
    await stop();
    throw error;
  }
}

/** The lifecycle status of a connection of the suite workspace, null when it is gone. */
export async function connectionStatus(
  suite: SuiteContext,
  connectionId: string,
): Promise<string | null> {
  const response = await createApiClient({token: suite.sessionToken}).requestJson<{
    connections: Array<{id: string; lifecycle_status: string}>;
  }>('get', `/integration-connections?workspace_id=${encodeURIComponent(suite.workspaceId)}`);
  return response.connections.find((item) => item.id === connectionId)?.lifecycle_status ?? null;
}
