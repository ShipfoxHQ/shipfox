import {join} from 'node:path';
import {E2eApiError, pollUntil, preflightCheck} from '@shipfox/e2e-core';
import {
  observeRun,
  type WorkflowJobObservation,
  type WorkflowRunObservation,
} from '@shipfox/e2e-observe-workflows';
import {startCaseRunner} from './case-runner.js';
import {bindConnectionSlugs, checkCompiledDefinition, failureMessage} from './compile.js';
import {setRunnerLabel} from './compose.js';
import {
  CONTRACT_FAKE_ADAPTERS,
  type ContractFake,
  type ContractFakeAdapter,
} from './contract-fakes.js';
import {caseJobKey, generateContractFiles} from './contract-generator.js';
import {type ContractFiles, loadContracts} from './contracts.js';
import {markSandboxConnections} from './contracts-compile.js';
import {createDefinition, fireManual} from './definitions.js';
import {matchesCase} from './discovery.js';
import {arrangeGithubProject} from './github-project.js';
import {observeWholeRun} from './observation.js';
import {type CaseResult, createRunId, type ResultsRun, writeResults} from './results.js';

// A provider workflow runs its cases on one local runner, so the timeout covers all of them.
const PROVIDER_RUN_TIMEOUT_MS = 300_000;
const TERMINAL_RUN_STATUSES = new Set(['succeeded', 'failed', 'cancelled']);
const MAX_DETAIL_CHARACTERS = 1_500;
const PROVIDER_FILE = /^contracts-(.+)\.yaml$/u;

export interface FakeProviderPlan {
  provider: string;
  /** The file name the real run syncs it as, such as `contracts-github.yaml`. */
  file: string;
  yaml: string;
  cases: Array<{id: string; jobKey: string}>;
}

/**
 * The workflow of each provider that has a `fake` case, with the cases that become its jobs.
 * `filter` keeps the cases whose id, provider, or workflow file name matches.
 */
export function planFakeRun({
  files,
  filter,
}: {
  files: ContractFiles;
  filter?: string | undefined;
}): FakeProviderPlan[] {
  const selected: ContractFiles = {
    ...files,
    cases: files.cases.filter(
      ({id, definition}) =>
        matchesCase(id, filter) ||
        matchesCase(definition.provider, filter) ||
        matchesCase(`contracts-${definition.provider}.yaml`, filter),
    ),
  };
  return generateContractFiles(selected, {mode: 'fake'}).map((file) => {
    const provider = PROVIDER_FILE.exec(file.name)?.[1];
    if (provider === undefined) throw new Error(`${file.name} is not a provider workflow.`);
    const cases = selected.cases
      .filter(
        ({definition}) => definition.provider === provider && definition.modes.includes('fake'),
      )
      .map((loaded) => ({id: loaded.id, jobKey: caseJobKey(loaded)}))
      .sort((a, b) => a.id.localeCompare(b.id));
    return {provider, file: file.name, yaml: file.content, cases};
  });
}

function truncate(text: string): string {
  return text.length > MAX_DETAIL_CHARACTERS ? `${text.slice(0, MAX_DETAIL_CHARACTERS)}...` : text;
}

/**
 * What a job's steps ended with, so a failed case shows which check missed. A call the gateway
 * rejected has no outputs, so its error code is the only reason.
 */
function describeJob(job: WorkflowJobObservation): string {
  const steps = (job.executions.at(-1)?.steps ?? []).filter((step) => step.status !== 'succeeded');
  return steps
    .map((step) => {
      const rejected = step.attempt_details
        .at(-1)
        ?.invocations?.filter((invocation) => invocation.outcome === 'error')
        .map((invocation) => invocation.error_code);
      return [
        `step "${step.key}" ended ${step.status}`,
        ...(rejected?.length ? [`tool error: ${rejected.join(', ')}`] : []),
        `gate: ${truncate(JSON.stringify(step.gate_result))}`,
        `outputs: ${truncate(JSON.stringify(step.outputs))}`,
      ].join('; ');
    })
    .join('\n');
}

function caseResult({
  id,
  status,
  error,
  runId,
  observation,
}: {
  id: string;
  status: CaseResult['status'];
  error?: string | undefined;
  runId?: string | undefined;
  observation?: WorkflowRunObservation | undefined;
}): CaseResult {
  return {
    case: id,
    mode: 'fake',
    repeat: 1,
    status,
    duration_ms: 0,
    cost_usd: 0,
    ...(error === undefined ? {} : {error}),
    ...(runId === undefined ? {} : {run_id: runId}),
    ...(observation === undefined ? {} : {observation}),
  };
}

/** Every case of a provider ends in error for one reason, such as a definition that won't compile. */
export function failProvider({
  plan,
  error,
}: {
  plan: FakeProviderPlan;
  error: string;
}): Map<string, CaseResult> {
  return new Map(plan.cases.map(({id}) => [id, caseResult({id, status: 'error', error})]));
}

/**
 * Maps each job of a finished provider run to its case. A succeeded job passes. A failed job means
 * the fake answered differently from the provider. Any other ending could not decide the case.
 */
export function mapJobResults({
  plan,
  runId,
  observation,
}: {
  plan: FakeProviderPlan;
  runId?: string | undefined;
  observation: WorkflowRunObservation;
}): Map<string, CaseResult> {
  const {jobs} = observation;
  return new Map(
    plan.cases.map(({id, jobKey}) => {
      const job = jobs.find((candidate) => candidate.key === jobKey);
      if (job === undefined) {
        const error = `The run has no job "${jobKey}".`;
        return [id, caseResult({id, status: 'error', error, runId})];
      }
      if (job.status === 'succeeded') return [id, caseResult({id, status: 'passed', runId})];
      const detail = describeJob(job);
      const error = `Job "${jobKey}" ended ${job.status}.${detail === '' ? '' : `\n${detail}`}`;
      const status = job.status === 'failed' ? 'failed' : 'error';
      // The run is shared by every case of the provider, so a failed case keeps only its own job.
      return [
        id,
        caseResult({id, status, error, runId, observation: {...observation, jobs: [job]}}),
      ];
    }),
  );
}

async function waitForRunEnd({
  runId,
  token,
  signal,
}: {
  runId: string;
  token: string;
  signal: AbortSignal;
}): Promise<WorkflowRunObservation['status']> {
  let status: WorkflowRunObservation['status'] | 'unknown' = 'unknown';
  return await pollUntil(
    {
      timeoutMs: PROVIDER_RUN_TIMEOUT_MS,
      intervalMs: 500,
      maxIntervalMs: 2_000,
      backoffFactor: 1.5,
      describe: () => `run ${runId} to end: status=${status}`,
      signal,
    },
    async () => {
      try {
        const observation = await observeRun({runId, token, signal});
        status = observation.status;
        return TERMINAL_RUN_STATUSES.has(observation.status) ? observation.status : null;
      } catch (error) {
        signal.throwIfAborted();
        // A run that was just started may not be readable yet.
        if (error instanceof E2eApiError && error.status === 404) return null;
        throw error;
      }
    },
  );
}

/** The workspace the provider workflows run in, once the fakes are seeded. */
interface FakeStack {
  /** Runs one provider's workflow and maps its jobs to cases. Never throws. */
  run(plan: FakeProviderPlan): Promise<Map<string, CaseResult>>;
}

async function arrangeFakeStack({
  files,
  plans,
  adapters,
  workDirectory,
  cleanups,
}: {
  files: ContractFiles;
  plans: FakeProviderPlan[];
  adapters: Readonly<Record<string, ContractFakeAdapter>>;
  workDirectory: string;
  cleanups: Array<() => Promise<void>>;
}): Promise<FakeStack> {
  const {uniqueId, github, workspace, session, client, connection, project} =
    await arrangeGithubProject({label: 'contracts', cleanups});
  const runner = await startCaseRunner({
    workspaceId: workspace.id,
    userToken: session.token,
    uniqueId,
    workDirectory,
    cleanups,
  });

  // A provider whose fake or seeding fails fails its own cases, and the others still run.
  const fakes = new Map<string, ContractFake | string>();
  for (const {provider} of plans) {
    const adapter = adapters[provider];
    if (adapter === undefined) {
      fakes.set(provider, `The ${provider} fake has no seeding adapter for the contracts suite.`);
      continue;
    }
    try {
      const fake = await adapter({
        workspaceId: workspace.id,
        uniqueId,
        github: {mock: github, connectionId: connection.id, connectionSlug: connection.slug},
        client,
        cleanups,
      });
      await fake.seed(files.manifest[provider]?.fixtures ?? {});
      fakes.set(provider, fake);
    } catch (error) {
      fakes.set(provider, `The ${provider} fake could not be seeded: ${failureMessage(error)}`);
    }
  }

  const runWorkflow = async ({
    plan,
    fake,
  }: {
    plan: FakeProviderPlan;
    fake: ContractFake;
  }): Promise<Map<string, CaseResult>> => {
    const marked = markSandboxConnections({yaml: plan.yaml, manifest: files.manifest});
    const yaml = setRunnerLabel({
      yaml: bindConnectionSlugs({yaml: marked.yaml, slugs: {[plan.provider]: fake.connectionSlug}}),
      label: runner.label,
    });
    const definition = await createDefinition({client, projectId: project.id, yaml});
    const problems = checkCompiledDefinition({yaml, definition});
    if (problems.length > 0) return failProvider({plan, error: problems.join('\n')});

    const runId = await fireManual({
      client,
      definitionId: definition.id,
      inputs: {},
      signal: runner.aborted,
    });
    await waitForRunEnd({runId, token: session.token, signal: runner.aborted});
    const observation = await observeWholeRun({runId, token: session.token, yaml});
    return mapJobResults({plan, runId, observation});
  };

  return {
    run: async (plan) => {
      const fake = fakes.get(plan.provider);
      if (typeof fake === 'string') return failProvider({plan, error: fake});
      if (fake === undefined) return failProvider({plan, error: 'The fake was not arranged.'});
      try {
        return await runWorkflow({plan, fake});
      } catch (error) {
        const exit = runner.exit();
        const runnerNote =
          exit === undefined
            ? ''
            : ` The local runner exited (code ${exit.code}, signal ${exit.signal}).${runner.tail()}`;
        return failProvider({plan, error: `${failureMessage(error)}${runnerNote}`});
      }
    },
  };
}

export interface ContractsFakeOptions {
  /** Runs the cases whose id, provider, or workflow file name matches, all of them when unset. */
  caseFilter?: string | undefined;
  /** The `cases/contracts` directory to load, the package's own when unset. */
  contractsRoot?: string | undefined;
  /** Runner logs and workspaces go below this directory. */
  workDirectory?: string | undefined;
  resultsDirectory?: string | undefined;
  runId?: string | undefined;
  /** Replaces the fake adapters. */
  adapters?: Readonly<Record<string, ContractFakeAdapter>> | undefined;
  /** Replaces running a provider's workflow against the stack, which tests don't have. */
  runProvider?: ((plan: FakeProviderPlan) => Promise<Map<string, CaseResult>>) | undefined;
}

/**
 * Runs every `fake` contract case against the E2E fakes. One workspace and project hold the
 * connections, each fake is seeded from the sandbox fixtures, and each provider's workflow is
 * started on its own, because the Slack, ClickUp, and Linear fakes listen on fixed addresses.
 */
export async function runContractsFake(options: ContractsFakeOptions = {}): Promise<ResultsRun> {
  const files = await loadContracts(options.contractsRoot);
  const plans = planFakeRun({files, filter: options.caseFilter});
  if (plans.length === 0 && options.caseFilter !== undefined) {
    throw new Error(`No fake contract cases matching "${options.caseFilter}" were found.`);
  }
  const runId = options.runId ?? createRunId();
  const cleanups: Array<() => Promise<void>> = [];
  try {
    let runProvider = options.runProvider;
    if (runProvider === undefined && plans.length > 0) {
      await preflightCheck({requireClient: false});
      const stack = await arrangeFakeStack({
        files,
        plans,
        adapters: options.adapters ?? CONTRACT_FAKE_ADAPTERS,
        workDirectory: options.workDirectory ?? join(process.cwd(), '.eval-run', runId),
        cleanups,
      });
      runProvider = (plan) => stack.run(plan);
    }
    const run = runProvider;

    // The cases of a provider share one run. Results are written one case at a time, so the
    // providers run one after the other.
    const planOf = new Map(plans.flatMap((plan) => plan.cases.map(({id}) => [id, plan] as const)));
    const providerRuns = new Map<string, Promise<Map<string, CaseResult>>>();
    return await writeResults({
      cases: plans.flatMap((plan) => plan.cases),
      mode: 'fake',
      repeat: 1,
      execute: async ({discovered}) => {
        const plan = planOf.get(discovered.id);
        if (plan === undefined || run === undefined) {
          throw new Error(`No provider run for case "${discovered.id}".`);
        }
        let providerRun = providerRuns.get(plan.provider);
        if (providerRun === undefined) {
          providerRun = run(plan);
          providerRuns.set(plan.provider, providerRun);
        }
        const result = (await providerRun).get(discovered.id);
        return (
          result ??
          caseResult({id: discovered.id, status: 'error', error: 'The run has no result.'})
        );
      },
      runId,
      ...(options.resultsDirectory === undefined
        ? {}
        : {resultsDirectory: options.resultsDirectory}),
    });
  } finally {
    for (const cleanup of cleanups.reverse()) await cleanup().catch(() => undefined);
  }
}
