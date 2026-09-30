import {cp, mkdir, mkdtemp, rm, stat, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import type {DefinitionListResponseDto, DefinitionResponseDto} from '@shipfox/api-definitions-dto';
import type {FireManualTriggerResponseDto} from '@shipfox/api-triggers-dto';
import {createApiClient, pollUntil} from '@shipfox/e2e-core';
import {startGithubApiMock} from '@shipfox/e2e-driver-github';
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
import {createSession, createUser} from '@shipfox/e2e-setup-auth';
import {createGithubConnection} from '@shipfox/e2e-setup-integrations';
import {createProject} from '@shipfox/e2e-setup-projects';
import {createWorkspace} from '@shipfox/e2e-setup-workspaces';
import {parse as parseYaml} from 'yaml';
import {runAwait} from './awaits.js';
import {composeCaseWorkflow, templateLoaderFor} from './compose.js';
import type {DiscoveredCase} from './discovery.js';
import type {PullRequestReference} from './references.js';
import type {CaseResult} from './results.js';
import {runScenario, type ScenarioDriver, ScenarioError} from './scenario.js';
import type {EventSenders} from './senders.js';

const SYNC_TIMEOUT_MS = 60_000;
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
}

/** Splits `owner/name`, giving a case with no repository one of its own. */
function repositoryName({
  repository,
  uniqueId,
}: {
  repository?: string | undefined;
  uniqueId: string;
}) {
  const [owner, name] = (repository ?? `acme/case-${uniqueId}`).split('/');
  if (!owner || !name) throw new Error(`Repository must be owner/name, received "${repository}".`);
  return {owner, name};
}

async function seedRepository({
  caseDirectory,
  directory,
}: {
  caseDirectory: string;
  directory: string;
}): Promise<void> {
  const source = join(caseDirectory, 'repo');
  const hasRepo = await stat(source).then(
    (entry) => entry.isDirectory(),
    () => false,
  );
  if (hasRepo) await cp(source, directory, {recursive: true});
  else await writeFile(join(directory, 'README.md'), '# Case repository\n');
}

async function waitForProjectSync({
  projectId,
  token,
}: {
  projectId: string;
  token: string;
}): Promise<void> {
  const client = createApiClient({token});
  let status = 'unknown';
  await pollUntil(
    {
      timeoutMs: SYNC_TIMEOUT_MS,
      intervalMs: 250,
      maxIntervalMs: 1_000,
      describe: () => `definition sync of project ${projectId}: status=${status}`,
    },
    async () => {
      const response = await client.requestJson<DefinitionListResponseDto>(
        'get',
        `/definitions?${new URLSearchParams({project_id: projectId, limit: '100'})}`,
      );
      status = response.sync?.status ?? 'null';
      return status === 'failed' || status === 'succeeded' ? response : null;
    },
  );
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
  } catch (error) {
    result.status = 'error';
    if (error instanceof ScenarioError) result.steps = error.records;
    result.error = failureMessage({error, arrangement});
  } finally {
    for (const cleanup of cleanups.reverse()) await cleanup().catch(() => undefined);
    result.duration_ms = Date.now() - startedAt;
  }
  return result;
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
  const uniqueId = crypto.randomUUID().replaceAll('-', '').slice(0, 10);
  const runnerLabel = `eval-${uniqueId}`;
  const installationId = Number.parseInt(uniqueId.slice(0, 7), 16) + 1;
  const installationToken = `ghs_${uniqueId}.${'e'.repeat(36)}.${'f'.repeat(36)}`;

  const github = await startGithubApiMock({installationId, installationToken});
  cleanups.push(() => github.stop());

  const seedDirectory = await mkdtemp(join(tmpdir(), 'eval-repository-'));
  cleanups.push(() => rm(seedDirectory, {recursive: true, force: true}));
  await seedRepository({caseDirectory: discovered.directory, directory: seedDirectory});
  const {owner, name} = repositoryName({repository: templateCase.repository, uniqueId});
  const repository = await github.addRepository({owner, name, seedDirectory});

  // A GitHub connection resyncs every project of its workspace when it becomes active, so each
  // case gets a workspace of its own.
  const user = await createUser({name: `Eval ${uniqueId}`});
  const workspace = await createWorkspace({
    userId: user.user.id,
    userEmail: user.email,
    name: `Eval ${discovered.id} ${uniqueId}`,
  });
  const session = await createSession({user_id: user.user.id});
  const client = createApiClient({token: session.token});
  const connection = await createGithubConnection({
    workspaceId: workspace.id,
    installationId,
    accountLogin: repository.owner,
    displayName: `Eval ${uniqueId}`,
    installerUserId: crypto.randomUUID(),
    lifecycleStatus: 'disabled',
  });
  await client.request('patch', `/integration-connections/${connection.id}`, {
    json: {lifecycle_status: 'active'},
  });
  const project = await createProject({
    workspaceId: workspace.id,
    name: `Eval ${uniqueId}`,
    sourceConnectionId: connection.id,
    sourceExternalRepositoryId: `github:${repository.id}`,
    sourceRepositoryOwner: repository.owner,
    sourceRepositoryName: repository.name,
    sourceDefaultBranch: repository.defaultBranch,
  });
  await waitForProjectSync({projectId: project.id, token: session.token});

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
    () => undefined,
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
    sendEvent: async ({provider, event, payload}) => {
      const send = senders[provider];
      if (send === undefined) {
        throw new Error(`No event sender is registered for provider "${provider}".`);
      }
      return (
        (await send({
          event,
          payload,
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
  };
}
