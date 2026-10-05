import {mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import type {WorkflowJobObservation, WorkflowRunObservation} from '@shipfox/e2e-observe-workflows';
import {afterEach, beforeEach, describe, expect, it} from '@shipfox/vitest/vi';
import {loadContracts} from './contracts.js';
import {
  type FakeProviderPlan,
  failProvider,
  mapJobResults,
  planFakeRun,
  runContractsFake,
} from './contracts-fake.js';
import type {CaseResult} from './results.js';

const fixtures = fileURLToPath(new URL('../test/fixtures/contracts/cases', import.meta.url));
const noMatchPattern = /No fake contract cases matching "missing" were found/u;

function job({
  key,
  status,
  gate,
  toolError,
}: {
  key: string;
  status: string;
  gate?: unknown;
  toolError?: string;
}): WorkflowJobObservation {
  return {
    key,
    status,
    executions: [
      {
        steps: [
          {
            key,
            status: status === 'succeeded' ? 'succeeded' : 'failed',
            gate_result: gate ?? null,
            outputs: {shape_id: false},
            attempt_details: [
              {
                invocations:
                  toolError === undefined ? [] : [{outcome: 'error', error_code: toolError}],
              },
            ],
          },
        ],
      },
    ],
  } as unknown as WorkflowJobObservation;
}

function observationOf(jobs: WorkflowJobObservation[]): WorkflowRunObservation {
  return {jobs} as unknown as WorkflowRunObservation;
}

describe('planFakeRun', () => {
  it('plans one workflow per provider with a fake case, and maps cases to job keys', async () => {
    const plans = planFakeRun({files: await loadContracts(fixtures)});

    expect(plans.map(({provider, file}) => [provider, file])).toEqual([
      ['linear', 'contracts-linear.yaml'],
    ]);
    expect(plans[0]?.cases).toEqual([
      {id: 'linear/fake-only', jobKey: 'fake_only'},
      {id: 'linear/get-issue', jobKey: 'get_issue'},
      {id: 'linear/get-issue-not-found', jobKey: 'get_issue_not_found'},
    ]);
    expect(plans[0]?.yaml).not.toContain('list_teams');
  });

  it.each([
    {filter: 'linear', cases: 3},
    {filter: 'contracts-linear.yaml', cases: 3},
    {filter: 'linear/get-issue', cases: 1},
    {filter: 'linear/get-*', cases: 2},
    {filter: 'github', cases: 0},
  ])('keeps the cases that match "$filter"', async ({filter, cases}) => {
    const plans = planFakeRun({files: await loadContracts(fixtures), filter});

    expect(plans.flatMap((plan) => plan.cases)).toHaveLength(cases);
  });
});

describe('mapJobResults', () => {
  const plan: FakeProviderPlan = {
    provider: 'linear',
    file: 'contracts-linear.yaml',
    yaml: '',
    cases: [
      {id: 'linear/get-issue', jobKey: 'get_issue'},
      {id: 'linear/get-team', jobKey: 'get_team'},
      {id: 'linear/list-teams', jobKey: 'list_teams'},
      {id: 'linear/missing', jobKey: 'missing'},
    ],
  };

  it('passes a succeeded job, fails a failed one with its steps, and errors on any other ending', () => {
    const results = mapJobResults({
      plan,
      runId: 'run-1',
      observation: observationOf([
        job({key: 'get_issue', status: 'succeeded'}),
        job({
          key: 'get_team',
          status: 'failed',
          gate: {kind: 'rejected'},
          toolError: 'repository-not-granted',
        }),
        job({key: 'list_teams', status: 'cancelled'}),
      ]),
    });

    expect(results.get('linear/get-issue')).toMatchObject({
      status: 'passed',
      mode: 'fake',
      run_id: 'run-1',
    });
    const failed = results.get('linear/get-team');
    expect(failed?.status).toBe('failed');
    expect(failed?.error).toContain('Job "get_team" ended failed.');
    expect(failed?.error).toContain('step "get_team" ended failed');
    expect(failed?.error).toContain('{"kind":"rejected"}');
    expect(failed?.error).toContain('tool error: repository-not-granted');
    // A failed case keeps its own job, not the whole run.
    expect(failed?.observation?.jobs.map(({key}) => key)).toEqual(['get_team']);
    expect(results.get('linear/list-teams')).toMatchObject({status: 'error'});
    expect(results.get('linear/missing')?.error).toBe('The run has no job "missing".');
  });

  it('fails every case of a provider with one reason', () => {
    const results = failProvider({plan, error: 'The definition did not compile.'});

    expect([...results.values()].map((result) => result.status)).toEqual([
      'error',
      'error',
      'error',
      'error',
    ]);
    expect(results.get('linear/get-issue')?.error).toBe('The definition did not compile.');
  });
});

describe('runContractsFake', () => {
  let directory: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'shipfox-eval-contracts-fake-'));
  });

  afterEach(async () => {
    await rm(directory, {recursive: true, force: true});
  });

  it('runs each provider once, and writes a result per case and a summary', async () => {
    const ran: string[] = [];

    const run = await runContractsFake({
      contractsRoot: fixtures,
      resultsDirectory: join(directory, 'results'),
      runId: 'fake-run',
      runProvider: (plan) => {
        ran.push(plan.provider);
        return Promise.resolve(
          mapJobResults({
            plan,
            observation: observationOf([
              job({key: 'get_issue', status: 'succeeded'}),
              job({key: 'get_issue_not_found', status: 'failed'}),
              job({key: 'fake_only', status: 'succeeded'}),
            ]),
          }),
        );
      },
    });

    expect(ran).toEqual(['linear']);
    expect(run.results.map(({case: id, status}: CaseResult) => [id, status])).toEqual([
      ['linear/fake-only', 'passed'],
      ['linear/get-issue', 'passed'],
      ['linear/get-issue-not-found', 'failed'],
    ]);
    const summary = await readFile(join(run.directory, 'summary.md'), 'utf8');
    expect(summary).toContain('- Mode: `fake`');
    expect(summary).toContain('- Failed: 1');
  });

  it('rejects a filter that matches no fake case', async () => {
    await expect(
      runContractsFake({
        contractsRoot: fixtures,
        caseFilter: 'missing',
        runProvider: () => Promise.resolve(new Map()),
      }),
    ).rejects.toThrow(noMatchPattern);
  });

  it('runs nothing, and needs no stack, when no case runs against a fake', async () => {
    // A contracts root with no case, so the test holds whatever fake cases the repository gains.
    const root = join(directory, 'contracts');
    await mkdir(root);
    await writeFile(join(root, 'sandbox.yaml'), '{}\n');
    await writeFile(join(root, 'backlog.yaml'), 'ceiling: 0\nentries: []\n');

    const run = await runContractsFake({
      contractsRoot: root,
      resultsDirectory: join(directory, 'results'),
      runId: 'empty-run',
    });

    expect(run.results).toEqual([]);
  });
});
