import {mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import type {DefinitionResponseDto} from '@shipfox/api-definitions-dto';
import type {FireManualTriggerResponseDto} from '@shipfox/api-triggers-dto';
import {pollUntil, type RecordedWrite} from '@shipfox/e2e-core';
import {
  type LocalRunnerExit,
  localRunnerLogTail,
  mintManualRegistrationToken,
  startLocalRunner,
  stopLocalRunner,
  waitForLocalRunnerExit,
} from '@shipfox/e2e-driver-runner-process';
import {
  observeRun,
  type WorkflowRunObservation,
  waitForRunByDeliveryId,
} from '@shipfox/e2e-observe-workflows';
import {parse as parseYaml} from 'yaml';
import {runAwait} from './awaits.js';
import {composeCaseWorkflow, templateLoaderFor} from './compose.js';
import type {DiscoveredCase} from './discovery.js';
import {arrangeGithubProject} from './github-project.js';
import {type PullRequestReference, resolveReferences} from './references.js';
import type {CaseResult} from './results.js';
import {runScenario, type ScenarioDriver, ScenarioError} from './scenario.js';
import type {TemplateCase} from './schema.js';
import type {EventSenders} from './senders.js';
import {checkOutputs, checkWrites} from './writes.js';

const START_TIMEOUT_MS = 60_000;
const RUNNER_TOKEN_TTL_SECONDS = 3_600;

export interface ExecuteCaseOptions {
  discovered: DiscoveredCase;
  mode: 'scripted' | 'live';
  repeat: number;
  /** Runner logs and workspaces go below this directory. */
  workDirectory: string;
  senders?: EventSenders | undefined;
}

interface Arrangement {
  driver: ScenarioDriver;
  token: string;
  yaml: string;
  runnerLogFile: string;
  runnerExit: () => LocalRunnerExit | undefined;
  runnerAborted: AbortSignal;
  runnerTail: () => string;
  /** Every write the GitHub fake accepted. Read before the fake stops. */
  writes: () => RecordedWrite[];
  references: ScenarioDriver['references'];
}

function stepKeysOf(yaml: string): string[] {
  const document = parseYaml(yaml) as {jobs?: Record<string, {steps?: Array<{key?: string}>}>};
  return Object.values(document.jobs ?? {}).flatMap((job) =>
    (job.steps ?? []).flatMap((step) => (step.key === undefined ? [] : [step.key])),
  );
}

/** The run with every job's executions and steps, so the result shows what happened. */
async function observeWholeRun({
  runId,
  token,
  yaml,
}: {
  runId: string;
  token: string;
  yaml: string;
}): Promise<WorkflowRunObservation> {
  const overview = await observeRun({runId, token});
  const stepKeys = stepKeysOf(yaml);
  return await observeRun({
    runId,
    token,
    selection: {
      jobs: overview.jobs.map((job) => ({
        jobKey: job.key,
        includeDefaultExecution: true,
        executionSequences: 'all',
        includeContext: true,
        stepKeys,
      })),
    },
  });
}

/**
 * Executes one case against the running stack: a workspace, a GitHub connection, a project on
 * the fake repository, the composed definition, a runner of its own, and then the scenario.
 * It never throws. A case that can't finish is an `error` result with the reason.
 */
export async function executeTemplateCase(options: ExecuteCaseOptions): Promise<CaseResult> {
  const {discovered, mode, repeat} = options;
  const templateCase = discovered.definition;
  const startedAt = Date.now();
  const cleanups: Array<() => Promise<void>> = [];
  const result: CaseResult = {
    case: discovered.id,
    mode,
    repeat,
    status: 'error',
    duration_ms: 0,
    cost_usd: 0,
  };
  let arrangement: Arrangement | undefined;
  let runId: string | undefined;

  try {
    arrangement = await arrange({options, cleanups});
    result.composed_yaml = arrangement.yaml;
    result.runner_log = arrangement.runnerLogFile;

    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(new Error('The case timeout ran out.')),
      templateCase.timeout_seconds * 1_000,
    );
    arrangement.runnerAborted.addEventListener('abort', () => controller.abort(), {once: true});
    // A runner that exited during setup aborted before this listener existed.
    if (arrangement.runnerAborted.aborted) controller.abort();
    try {
      const scenario = await runScenario({
        steps: templateCase.scenario,
        driver: arrangement.driver,
        deadline: Date.now() + templateCase.timeout_seconds * 1_000,
        signal: controller.signal,
      });
      runId = scenario.runId;
      result.steps = scenario.records;
    } finally {
      clearTimeout(timer);
    }
    result.status = 'passed';
    result.run_id = runId;
    result.observation = await observeWholeRun({
      runId,
      token: arrangement.token,
      yaml: arrangement.yaml,
    });
    result.writes = arrangement.writes();
    const failures = checkExpectations({
      expect: templateCase.expect,
      outputs: result.observation.attempt.outputs ?? null,
      writes: result.writes,
      references: arrangement.references,
    });
    if (failures.length > 0) {
      result.status = 'failed';
      result.error = failures.join('\n');
    }
  } catch (error) {
    result.status = 'error';
    if (error instanceof ScenarioError) result.steps = error.records;
    if (arrangement !== undefined) result.writes = arrangement.writes();
    result.error = failureMessage({error, arrangement});
  } finally {
    for (const cleanup of cleanups.reverse()) await cleanup().catch(() => undefined);
    result.duration_ms = Date.now() - startedAt;
  }
  return result;
}

/** What the case expected and the run didn't do, one message each. Empty when the case passed. */
function checkExpectations({
  expect,
  outputs,
  writes,
  references,
}: {
  expect: TemplateCase['expect'];
  outputs: Record<string, unknown> | null;
  writes: RecordedWrite[];
  references: ScenarioDriver['references'];
}): string[] {
  let resolved: Pick<TemplateCase['expect'], 'outputs' | 'writes'>;
  try {
    resolved = resolveReferences(
      {outputs: expect.outputs, writes: expect.writes},
      references,
    ) as typeof resolved;
  } catch (error) {
    return [
      `The expectations could not be resolved: ${error instanceof Error ? error.message : String(error)}`,
    ];
  }
  return [
    ...(resolved.outputs === undefined
      ? []
      : checkOutputs({expected: resolved.outputs, actual: outputs})),
    ...checkWrites({expected: resolved.writes, recorded: writes}),
  ];
}

function failureMessage({
  error,
  arrangement,
}: {
  error: unknown;
  arrangement: Arrangement | undefined;
}): string {
  const message = error instanceof Error ? error.message : String(error);
  const exit = arrangement?.runnerExit();
  if (arrangement === undefined || exit === undefined) return message;
  return `The local runner exited (code ${exit.code}, signal ${exit.signal}) before the scenario finished. ${message}${arrangement.runnerTail()}`;
}

async function arrange({
  options,
  cleanups,
}: {
  options: ExecuteCaseOptions;
  cleanups: Array<() => Promise<void>>;
}): Promise<Arrangement> {
  const {discovered, workDirectory} = options;
  const templateCase = discovered.definition;
  const {uniqueId, github, repository, workspace, session, client, connection, project} =
    await arrangeGithubProject({
      caseDirectory: discovered.directory,
      repository: templateCase.repository,
      label: discovered.id,
      cleanups,
    });
  const runnerLabel = `eval-${uniqueId}`;

  const runnerDirectory = join(workDirectory, 'runners');
  await mkdir(runnerDirectory, {recursive: true});
  const logFile = join(runnerDirectory, `${runnerLabel}.log`);
  const registrationToken = await mintManualRegistrationToken({
    workspaceId: workspace.id,
    userToken: session.token,
    name: `Eval ${uniqueId}`,
    ttlSeconds: RUNNER_TOKEN_TTL_SECONDS,
  });
  const runner = startLocalRunner({
    workspaceId: workspace.id,
    registrationToken: registrationToken.raw_token,
    labels: [runnerLabel],
    logFile,
    workspaceRoot: join(workDirectory, 'runner-workspaces', runnerLabel),
  });
  let stopping = false;
  cleanups.push(async () => {
    stopping = true;
    await stopLocalRunner(runner);
  });
  let exit: LocalRunnerExit | undefined;
  const exited = new AbortController();
  waitForLocalRunnerExit(runner).then(
    (value) => {
      if (stopping) return;
      exit = value;
      exited.abort();
    },
    () => {
      // The child process failed to spawn or crashed before it could report an exit.
      if (stopping) return;
      exit = {code: null, signal: null};
      exited.abort();
    },
  );

  const yaml = await composeCaseWorkflow({
    templateCase,
    loader: templateLoaderFor({templateCase, caseDirectory: discovered.directory}),
    runnerLabel,
  });
  const definition = await client.requestJson<DefinitionResponseDto>('post', '/definitions', {
    json: {project_id: project.id, source: 'manual', yaml},
  });

  const senders = options.senders ?? {};
  const pullRequest = (): PullRequestReference => {
    const [number, pr] =
      [...github.pullRequests.entries()]
        .filter(([, candidate]) => candidate.repository === repository.fullName)
        .sort(([left], [right]) => right - left)[0] ?? [];
    if (number === undefined || pr === undefined) {
      throw new Error(`No pull request has been opened in ${repository.fullName}.`);
    }
    return {
      number,
      head: pr.ref,
      base: pr.base ?? repository.defaultBranch,
      sha: pr.sha,
      repository: repository.fullName,
    };
  };

  const driver: ScenarioDriver = {
    references: {pr: pullRequest},
    startManual: async ({inputs}) => {
      const response = await pollUntil<FireManualTriggerResponseDto>(
        {
          timeoutMs: START_TIMEOUT_MS,
          intervalMs: 250,
          maxIntervalMs: 4_000,
          backoffFactor: 1.5,
          describe: () => `manual trigger of definition ${definition.id}`,
        },
        async () =>
          await client.requestJson<FireManualTriggerResponseDto>(
            'post',
            `/workflow-definitions/${definition.id}/fire-manual`,
            {json: {inputs}},
          ),
      );
      return response.workflow_run_id;
    },
    sendEvent: async ({provider, event, payload, signal}) => {
      const send = senders[provider];
      if (send === undefined) {
        throw new Error(`No event sender is registered for provider "${provider}".`);
      }
      return (
        (await send({
          event,
          payload,
          signal,
          context: {
            workspaceId: workspace.id,
            projectId: project.id,
            connectionId: connection.id,
            token: session.token,
            repository: repository.fullName,
          },
        })) ?? {}
      );
    },
    runForDelivery: async ({deliveryId, timeoutMs, signal}) => {
      const run = await waitForRunByDeliveryId({
        deliveryId,
        projectId: project.id,
        workspaceId: workspace.id,
        token: session.token,
        timeoutMs,
        ...(signal === undefined ? {} : {signal}),
      });
      return run.id;
    },
    awaitStep: async ({step, runId, timeoutMs, signal}) =>
      await runAwait({step, runId, token: session.token, timeoutMs, signal}),
  };

  return {
    driver,
    token: session.token,
    yaml,
    runnerLogFile: logFile,
    runnerExit: () => exit,
    runnerAborted: exited.signal,
    runnerTail: () => localRunnerLogTail(logFile),
    writes: () => github.writes(),
    references: driver.references,
  };
}
