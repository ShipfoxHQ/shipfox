import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import type {PageContextDto} from '@shipfox/api-agent-dto';
import {createApiClient} from '@shipfox/e2e-core';
import {type WorkflowRunObservation, waitForRunTerminal} from '@shipfox/e2e-observe-workflows';
import {createSession, createUser} from '@shipfox/e2e-setup-auth';
import {createProject} from '@shipfox/e2e-setup-projects';
import {createWorkspace} from '@shipfox/e2e-setup-workspaces';
import {type CaseRunner, startCaseRunner} from './case-runner.js';
import {setRunnerLabel} from './compose.js';
import {createDefinition, fireManual} from './definitions.js';
import type {ShippyCase, ShippyPage, ShippySeedRun} from './shippy-schema.js';

const SEED_RUN_TIMEOUT_MS = 300_000;

export interface SeededRun {
  key: string;
  id: string;
  observation: WorkflowRunObservation;
}

export interface ShippyWorkspace {
  uniqueId: string;
  workspaceId: string;
  projectId: string;
  token: string;
  client: ReturnType<typeof createApiClient>;
  runner: CaseRunner | undefined;
  runs: Map<string, SeededRun>;
}

/**
 * A workspace of its own with one project and no repository, because Shippy reads runs and
 * needs no checkout. Seeded runs get a local runner, and nothing else does.
 */
export async function arrangeShippyWorkspace({
  shippyCase,
  caseDirectory,
  label,
  workDirectory,
  cleanups,
}: {
  shippyCase: ShippyCase;
  caseDirectory: string;
  label: string;
  workDirectory: string;
  cleanups: Array<() => Promise<void>>;
}): Promise<ShippyWorkspace> {
  const uniqueId = crypto.randomUUID().replaceAll('-', '').slice(0, 10);
  const user = await createUser({name: `Eval ${uniqueId}`});
  const workspace = await createWorkspace({
    userId: user.user.id,
    userEmail: user.email,
    name: `Eval ${label} ${uniqueId}`,
  });
  const session = await createSession({user_id: user.user.id});
  const client = createApiClient({token: session.token});
  const project = await createProject({workspaceId: workspace.id, name: `Eval ${uniqueId}`});

  const arranged: ShippyWorkspace = {
    uniqueId,
    workspaceId: workspace.id,
    projectId: project.id,
    token: session.token,
    client,
    runner: undefined,
    runs: new Map(),
  };
  if (shippyCase.seed.runs.length === 0) return arranged;

  arranged.runner = await startCaseRunner({
    workspaceId: workspace.id,
    userToken: session.token,
    uniqueId,
    workDirectory,
    cleanups,
  });
  for (const seed of shippyCase.seed.runs) {
    arranged.runs.set(seed.key, await seedRun({arranged, seed, caseDirectory}));
  }
  return arranged;
}

/** Fires one seeded run and waits for it to end as the case says it must. */
async function seedRun({
  arranged,
  seed,
  caseDirectory,
}: {
  arranged: ShippyWorkspace;
  seed: ShippySeedRun;
  caseDirectory: string;
}): Promise<SeededRun> {
  const runner = arranged.runner;
  if (runner === undefined) throw new Error('A seeded run needs the case runner');
  const yaml = setRunnerLabel({
    yaml: await readFile(join(caseDirectory, seed.workflow), 'utf8'),
    label: runner.label,
  });
  const definition = await createDefinition({
    client: arranged.client,
    projectId: arranged.projectId,
    yaml,
  });
  const runId = await fireManual({
    client: arranged.client,
    definitionId: definition.id,
    inputs: seed.inputs,
    signal: runner.aborted,
  });
  const observation = await waitForRunTerminal({
    runId,
    token: arranged.token,
    timeoutMs: SEED_RUN_TIMEOUT_MS,
    signal: runner.aborted,
  });
  if (observation.status !== seed.status) {
    throw new Error(
      `Seeded run ${seed.key} ended ${observation.status}, and the case expects ${seed.status}.${runner.tail()}`,
    );
  }
  return {key: seed.key, id: runId, observation};
}

/** The page context the client would send for the page a turn names. */
export function pageContextFor(
  page: ShippyPage | undefined,
  runs: ReadonlyMap<string, SeededRun>,
): PageContextDto | undefined {
  if (page === undefined) return undefined;
  if (page.page === 'runs' || page.page === 'workflows') return {page: page.page};
  const run = runs.get(page.run);
  if (run === undefined) throw new Error(`No seeded run named ${page.run}`);
  const base = {
    run_id: run.id,
    attempt: run.observation.current_attempt,
    status: run.observation.status,
  };
  if (page.page === 'run') return {page: 'run', ...base};
  const job = run.observation.jobs.find((candidate) => candidate.key === page.job);
  if (job === undefined) throw new Error(`Run ${page.run} has no job named ${page.job}`);
  return {page: 'job', ...base, job_id: job.id};
}
