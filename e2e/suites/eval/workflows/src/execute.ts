import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import type {DefinitionResponseDto} from '@shipfox/api-definitions-dto';
import type {FireManualTriggerResponseDto} from '@shipfox/api-triggers-dto';
import {type createApiClient, pollUntil, type RecordedWrite, requestJson} from '@shipfox/e2e-core';
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
import {
  getOpenRouterCost,
  getScriptedManagedProviderRequests,
  registerOpenRouterManagedProvider,
  registerScriptedManagedProvider,
  type ScriptedManagedProviderRequest,
} from '@shipfox/e2e-setup-agent';
import {parse as parseYaml} from 'yaml';
import {runAwait} from './awaits.js';
import {bindConnectionSlugs} from './compile.js';
import {composeCaseWorkflow, setRunnerLabel, templateLoaderFor} from './compose.js';
import type {DiscoveredCase} from './discovery.js';
import {createGithubEventSender} from './github-events.js';
import {arrangeGithubProject} from './github-project.js';
import {type HiddenTestsResult, runHiddenTests} from './hidden-tests.js';
import {arrangeJiraTracker} from './jira.js';
import {arrangeLinearWorkspace} from './linear-workspace.js';
import {collectMeasures, type RunMeasures} from './measures.js';
import {type PullRequestReference, resolveReferences} from './references.js';
import type {CaseResult} from './results.js';
import {runScenario, type ScenarioDriver, ScenarioError} from './scenario.js';
import type {TemplateCase} from './schema.js';
import {agentStepKeys} from './scripted.js';
import type {EventSenders} from './senders.js';
import {arrangeSlackWorkspace} from './slack-workspace.js';
import {checkOutputs, checkWrites} from './writes.js';

const START_TIMEOUT_MS = 60_000;
const RUNNER_TOKEN_TTL_SECONDS = 3_600;
const RUNNER_LOG_TAIL_LINES = 200;
const MAX_PROMPT_CHARACTERS = 2_000;
const HIDDEN_TESTS_TIMEOUT_MS = 300_000;

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
  /** Every write the provider fakes accepted. Read before the fakes stop. */
  writes: () => RecordedWrite[];
  references: ScenarioDriver['references'];
  /** Every request the scripted model provider served, when the case registered a script. */
  modelRequests: () => Promise<ScriptedManagedProviderRequest[] | undefined>;
  /** Live runs only: the tokens and gate retries of a finished run. */
  measures: (params: {runId: string; observation: WorkflowRunObservation}) => Promise<RunMeasures>;
  /** Live runs only: what OpenRouter charged for the case's model requests, in USD. */
  cost: () => Promise<number>;
  /** Runs the case's hidden tests on the branch of the pull request the run opened. */
  hiddenTests: () => Promise<HiddenTestsResult | undefined>;
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

    const scenario = await driveScenario({templateCase, arrangement});
    runId = scenario.runId;
    result.steps = scenario.records;
    result.status = 'passed';
    result.run_id = runId;
    result.observation = await observeWholeRun({
      runId,
      token: arrangement.token,
      yaml: arrangement.yaml,
    });
    result.writes = arrangement.writes();
    const failures = [
      ...checkExpectations({
        expect: templateCase.expect,
        outputs: result.observation.attempt.outputs ?? null,
        writes: result.writes,
        references: arrangement.references,
      }),
      ...surpriseFailures(await arrangement.modelRequests()),
      ...(mode === 'live' ? await gradeLiveRun({result, arrangement, runId}) : []),
    ];
    if (failures.length > 0) {
      result.status = 'failed';
      result.error = failures.join('\n');
    }
  } catch (error) {
    result.status = 'error';
    if (arrangement !== undefined) {
      result.writes = arrangement.writes();
      await attachScenarioFailure({result, error, arrangement});
    }
    result.error = failureMessage({error, arrangement});
  } finally {
    if (mode === 'live' && arrangement !== undefined) {
      await recordCost({result, arrangement});
    }
    for (const cleanup of cleanups.reverse()) await cleanup().catch(() => undefined);
    if (result.status !== 'passed' && arrangement !== undefined) {
      await attachFailureContext({result, arrangement});
    }
    result.duration_ms = Date.now() - startedAt;
  }
  return result;
}

/** Runs the scenario within the case's timeout, and stops it when the case's runner exits. */
async function driveScenario({
  templateCase,
  arrangement,
}: {
  templateCase: TemplateCase;
  arrangement: Arrangement;
}) {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new Error('The case timeout ran out.')),
    templateCase.timeout_seconds * 1_000,
  );
  arrangement.runnerAborted.addEventListener('abort', () => controller.abort(), {once: true});
  // A runner that exited during setup aborted before this listener existed.
  if (arrangement.runnerAborted.aborted) controller.abort();
  try {
    return await runScenario({
      steps: templateCase.scenario,
      driver: arrangement.driver,
      deadline: Date.now() + templateCase.timeout_seconds * 1_000,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

/** The measures of a live run and its hidden tests, and what the hidden tests failed. */
async function gradeLiveRun({
  result,
  arrangement,
  runId,
}: {
  result: CaseResult;
  arrangement: Arrangement;
  runId: string;
}): Promise<string[]> {
  if (result.observation !== undefined) {
    result.measures = await arrangement.measures({runId, observation: result.observation});
  }
  const hiddenTests = await arrangement.hiddenTests();
  if (hiddenTests === undefined) return [];
  result.hidden_tests = hiddenTests;
  if (hiddenTests.passed) return [];
  // Without an exit code the test command never finished, and its output holds the reason.
  const reason = hiddenTests.exit_code === null ? ` ${hiddenTests.output_tail}` : '';
  return [`The hidden tests failed (exit code ${hiddenTests.exit_code}).${reason}`];
}

/** Spent even when the case failed, so the budget counts it. */
async function recordCost({
  result,
  arrangement,
}: {
  result: CaseResult;
  arrangement: Arrangement;
}): Promise<void> {
  try {
    result.cost_usd = await arrangement.cost();
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    result.status = 'error';
    result.error = `${result.error ?? ''}\nThe cost could not be read: ${reason}`.trim();
  }
}

/** What a failed scenario did before it failed: its steps and, once a run started, the run. */
async function attachScenarioFailure({
  result,
  error,
  arrangement,
}: {
  result: CaseResult;
  error: unknown;
  arrangement: Arrangement;
}): Promise<void> {
  if (!(error instanceof ScenarioError)) return;
  result.steps = error.records;
  if (error.runId === undefined) return;
  result.run_id = error.runId;
  const observation = await observeWholeRun({
    runId: error.runId,
    token: arrangement.token,
    yaml: arrangement.yaml,
  }).catch(() => undefined);
  if (observation !== undefined) result.observation = observation;
}

/** A request the script had no reply for, one message each. */
function surpriseFailures(requests: ScriptedManagedProviderRequest[] | undefined): string[] {
  return (requests ?? [])
    .filter((request) => request.surprise)
    .map(
      (request) =>
        `Unexpected model request ${request.index} from step attempt ${request.step_attempt_id}: ${request.error ?? 'no reply'}`,
    );
}

/** The script's recorded requests and the end of the runner log, so a failure can be read. */
async function attachFailureContext({
  result,
  arrangement,
}: {
  result: CaseResult;
  arrangement: Arrangement;
}): Promise<void> {
  const requests = await arrangement.modelRequests().catch(() => undefined);
  if (requests !== undefined) {
    result.model_requests = requests.map((request) => ({
      ...request,
      prompt:
        request.prompt.length > MAX_PROMPT_CHARACTERS
          ? `...${request.prompt.slice(-MAX_PROMPT_CHARACTERS)}`
          : request.prompt,
    }));
  }
  const log = await readFile(arrangement.runnerLogFile, 'utf8').catch(() => undefined);
  if (log !== undefined) {
    result.runner_log_tail = log.trimEnd().split('\n').slice(-RUNNER_LOG_TAIL_LINES).join('\n');
  }
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

/** The Linear, Jira, and Slack connections and fakes a case binds. A provider it doesn't bind is skipped. */
async function arrangeProviderFakes({
  templateCase,
  workspaceId,
  uniqueId,
  cleanups,
}: {
  templateCase: TemplateCase;
  workspaceId: string;
  uniqueId: string;
  cleanups: Array<() => Promise<void>>;
}) {
  const binds = (provider: string) => Object.values(templateCase.bindings).includes(provider);
  const linearIssues = templateCase.seed.linear?.issues ?? [];
  const linear = binds('linear')
    ? await arrangeLinearWorkspace({workspaceId, uniqueId, issues: linearIssues, cleanups})
    : undefined;

  const jira = binds('jira')
    ? await arrangeJiraTracker({workspaceId, uniqueId, cleanups})
    : undefined;

  const slack = binds('slack')
    ? await arrangeSlackWorkspace({
        workspaceId,
        uniqueId,
        seed: templateCase.seed.slack,
        cleanups,
      })
    : undefined;
  return {linear, jira, slack};
}

/** A definition with a file path is a repository definition, which is how Shipfox names a workflow. */
async function createDefinition({
  client,
  projectId,
  yaml,
  file,
}: {
  client: ReturnType<typeof createApiClient>;
  projectId: string;
  yaml: string;
  file?: {path: string; ref: string} | undefined;
}): Promise<DefinitionResponseDto> {
  return await client.requestJson<DefinitionResponseDto>('post', '/definitions', {
    json: {
      project_id: projectId,
      yaml,
      ...(file === undefined
        ? {source: 'manual'}
        : {source: 'vcs', config_path: file.path, ref: file.ref}),
    },
  });
}

async function fireManual({
  client,
  definitionId,
  inputs,
  timeoutMs = START_TIMEOUT_MS,
  signal,
}: {
  client: ReturnType<typeof createApiClient>;
  definitionId: string;
  inputs: Record<string, unknown>;
  /** Bounds the wait for the trigger to accept the run. */
  timeoutMs?: number;
  signal?: AbortSignal | undefined;
}): Promise<string> {
  const response = await pollUntil<FireManualTriggerResponseDto>(
    {
      timeoutMs,
      intervalMs: 250,
      maxIntervalMs: 4_000,
      backoffFactor: 1.5,
      describe: () => `manual trigger of definition ${definitionId}`,
      ...(signal === undefined ? {} : {signal}),
    },
    async () =>
      await client.requestJson<FireManualTriggerResponseDto>(
        'post',
        `/workflow-definitions/${definitionId}/fire-manual`,
        {json: {inputs}},
      ),
  );
  return response.workflow_run_id;
}

function hasEventTrigger(yaml: string): boolean {
  const document = parseYaml(yaml) as {triggers?: Record<string, {source?: string}>};
  return Object.values(document.triggers ?? {}).some((trigger) => trigger.source !== 'manual');
}

async function waitForTriggers({definitionId}: {definitionId: string}): Promise<void> {
  await pollUntil(
    {
      timeoutMs: START_TIMEOUT_MS,
      intervalMs: 250,
      maxIntervalMs: 1_000,
      describe: () => `trigger subscriptions of definition ${definitionId}`,
    },
    async () => {
      const {ready} = await requestJson<{ready: boolean}>(
        'get',
        `/__e2e/triggers/definitions/${definitionId}/readiness`,
        {},
      );
      return ready ? true : null;
    },
  );
}

/**
 * The first run that a Shipfox event started in the case's project, where only the case's own
 * workflow listens for one. Any later run is an extra report, which the case's strict writes catch.
 */
async function waitForTriggeredRun({
  client,
  projectId,
  timeoutMs,
  signal,
}: {
  client: ReturnType<typeof createApiClient>;
  projectId: string;
  timeoutMs: number;
  signal?: AbortSignal | undefined;
}): Promise<string> {
  const query = new URLSearchParams({
    project_id: projectId,
    trigger_source: 'shipfox',
    limit: '100',
  });
  const run = await pollUntil<{id: string}>(
    {
      timeoutMs,
      intervalMs: 250,
      maxIntervalMs: 2_000,
      backoffFactor: 1.5,
      describe: () => `a run of project ${projectId} started by a Shipfox event`,
      ...(signal === undefined ? {} : {signal}),
    },
    async () => {
      const page = await client.requestJson<{runs: Array<{id: string}>}>(
        'get',
        `/workflows/runs?${query}`,
      );
      // The list is newest first.
      return page.runs.at(-1) ?? null;
    },
  );
  return run.id;
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
  // Job git config includes the global one, so a developer's commit signing would break pushes.
  const gitConfig = join(runnerDirectory, `${runnerLabel}.gitconfig`);
  await writeFile(gitConfig, '');
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
    extraEnv: {GIT_CONFIG_GLOBAL: gitConfig},
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

  const {linear, jira, slack} = await arrangeProviderFakes({
    templateCase,
    workspaceId: workspace.id,
    uniqueId,
    cleanups,
  });

  // The case workspace holds a connection to the GitHub fake, and to the Linear, Jira, and Slack
  // fakes when the case binds them, so only those roles bind.
  const connectionSlugs: Record<string, string> = {
    github: connection.slug,
    ...(linear === undefined ? {} : {linear: linear.connectionSlug}),
    ...(jira === undefined ? {} : {jira: jira.connectionSlug}),
    ...(slack === undefined ? {} : {slack: slack.connectionSlug}),
  };
  const slugs = Object.fromEntries(
    Object.entries(templateCase.bindings).flatMap(([role, provider]) => {
      const slug = connectionSlugs[provider];
      return slug === undefined ? [] : [[role, slug]];
    }),
  );
  // `$project.id` is the project the case created, known only after the workspace is arranged.
  const placeholders = Object.fromEntries(
    Object.entries(templateCase.placeholders).map(([placeholder, value]) => [
      placeholder,
      value === '$project.id' ? project.id : value,
    ]),
  );
  const yaml = bindConnectionSlugs({
    yaml: await composeCaseWorkflow({
      templateCase: {...templateCase, placeholders},
      loader: templateLoaderFor({templateCase, caseDirectory: discovered.directory}),
      runnerLabel,
    }),
    slugs,
  });
  // A Shipfox event names the workflow that raised it by its file path, so a case that fires other
  // workflows registers every definition as a file of the repository.
  const workflowFile = (name: string) =>
    Object.keys(templateCase.workflows).length === 0
      ? undefined
      : {path: `.shipfox/workflows/${name}.yml`, ref: repository.defaultBranch};
  const definition = await createDefinition({
    client,
    projectId: project.id,
    yaml,
    file: workflowFile(templateCase.template.split('/').at(-1) ?? 'template'),
  });
  const otherDefinitions = new Map<string, DefinitionResponseDto>();
  for (const [name, file] of Object.entries(templateCase.workflows)) {
    const source = await readFile(join(discovered.directory, file), 'utf8');
    otherDefinitions.set(
      name,
      await createDefinition({
        client,
        projectId: project.id,
        yaml: setRunnerLabel({yaml: source, label: runnerLabel}),
        file: workflowFile(name),
      }),
    );
  }
  // A definition's triggers are projected after it is created, and an event that arrives before
  // then starts nothing.
  if (hasEventTrigger(yaml)) await waitForTriggers({definitionId: definition.id});
  const script = options.mode === 'scripted' ? discovered.script : undefined;
  // Without a script, the managed provider answers every request with fixed text, and a step
  // without outputs would pass on it.
  const agentSteps = agentStepKeys(yaml);
  if (options.mode === 'scripted' && script === undefined && agentSteps.length > 0) {
    throw new Error(
      `The case has agent steps (${agentSteps.join(', ')}) but no scripted.yaml for scripted mode.`,
    );
  }
  if (script !== undefined) {
    await registerScriptedManagedProvider({projectId: project.id, entries: script});
  }
  if (options.mode === 'live') await registerOpenRouterManagedProvider({projectId: project.id});

  const senders: EventSenders = {
    github: createGithubEventSender(github),
    ...(linear === undefined ? {} : {linear: linear.sender}),
    ...(jira === undefined ? {} : {jira: jira.sender}),
    ...(slack === undefined ? {} : {slack: slack.sender}),
    ...options.senders,
  };
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
    startManual: async ({inputs}) =>
      await fireManual({client, definitionId: definition.id, inputs}),
    fireWorkflow: async ({workflow, inputs, status, timeoutMs, signal}) => {
      const fired = otherDefinitions.get(workflow);
      if (fired === undefined) throw new Error(`The case has no workflow named "${workflow}".`);
      // Firing and waiting for the run's end share the step's one timeout.
      const startedAt = Date.now();
      const runId = await fireManual({
        client,
        definitionId: fired.id,
        inputs,
        timeoutMs: Math.min(timeoutMs, START_TIMEOUT_MS),
        signal,
      });
      await runAwait({
        step: {run: status},
        runId,
        token: session.token,
        timeoutMs: Math.max(timeoutMs - (Date.now() - startedAt), 1),
        signal,
      });
    },
    runTriggered: async ({timeoutMs, signal}) =>
      await waitForTriggeredRun({
        client,
        projectId: project.id,
        timeoutMs,
        signal,
      }),
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
    writes: () => [
      ...github.writes(),
      ...(linear?.writes() ?? []),
      ...(jira?.writes() ?? []),
      ...(slack?.writes() ?? []),
    ],
    references: driver.references,
    modelRequests: async () =>
      script === undefined
        ? undefined
        : await getScriptedManagedProviderRequests({projectId: project.id}),
    measures: async ({runId, observation}) =>
      await collectMeasures({client, workspaceId: workspace.id, runId, observation}),
    cost: async () => (await getOpenRouterCost({projectId: project.id})).cost_usd,
    hiddenTests: async () => {
      const hiddenTests = templateCase.live?.hidden_tests;
      if (hiddenTests === undefined) return undefined;
      const testCommand = templateCase.slots.test_command;
      if (testCommand === undefined) {
        throw new Error('A case with hidden_tests needs a test_command slot to run them with.');
      }
      let branch: string;
      try {
        branch = pullRequest().head;
      } catch {
        return {
          passed: false,
          exit_code: null,
          output_tail: 'The run opened no pull request, so there was no branch to test.',
        };
      }
      return await runHiddenTests({
        repositoryPath: repository.path,
        branch,
        caseDirectory: discovered.directory,
        hiddenTests,
        testCommand,
        timeoutMs: HIDDEN_TESTS_TIMEOUT_MS,
      });
    },
  };
}
