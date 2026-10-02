import {mkdir, mkdtemp, readdir, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {afterEach, describe, expect, it} from '@shipfox/vitest/vi';
import {exitCodeFor, runEval} from './cli.js';
import {discoverCases} from './discovery.js';
import type {CaseResult} from './results.js';
import {parseTemplateCase} from './schema.js';

const temporaryDirectories: string[] = [];
const invalidCasePattern = /scenario/iu;
const invalidScenarioPattern = /case\.yaml: scenario\.\d+: Invalid input/u;
const duplicatePattern = /issue identifiers must be unique/u;
const duplicateNumberPattern = /issue numbers must be unique/u;
const undeclaredModePattern = /does not declare mode "live"/u;
const seedPattern = /seed\.slack\.thread/u;
const placeholderPattern = /placeholders/u;
const duplicateTaskPattern = /task IDs must be unique/u;

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, {recursive: true})),
  );
});

describe('template case discovery', () => {
  it('discovers and validates the fixture case', async () => {
    const cases = await discoverCases(
      fileURLToPath(new URL('../cases/templates/', import.meta.url)),
    );

    const fixture = cases.find((entry) => entry.id === 'fixture');
    expect(fixture?.definition.bindings).toEqual({source: 'github'});
  });

  it('reports the field that makes an invalid case unreadable', async () => {
    const root = await mkdtemp(join(tmpdir(), 'shipfox-eval-invalid-'));
    temporaryDirectories.push(root);
    const caseDirectory = join(root, 'broken');
    await mkdir(caseDirectory);
    await writeFile(join(caseDirectory, 'case.yaml'), 'template: shipfox/fixture\nexpect: {}\n');

    await expect(discoverCases(root)).rejects.toThrow(invalidCasePattern);
  });
});

const passing = ({discovered, repeat}: {discovered: {id: string}; repeat: number}): CaseResult => ({
  case: discovered.id,
  mode: 'scripted',
  repeat,
  status: 'passed',
  duration_ms: 1,
  cost_usd: 0,
});

describe('eval results', () => {
  it('writes one result per repeat and a summary', async () => {
    const root = await mkdtemp(join(tmpdir(), 'shipfox-eval-results-'));
    temporaryDirectories.push(root);
    const resultsDirectory = join(root, 'results');

    const run = await runEval({
      suite: 'templates',
      mode: 'scripted',
      repeat: 2,
      cwd: fileURLToPath(new URL('../', import.meta.url)),
      caseFilter: 'fixture',
      resultsDirectory,
      runId: 'proof',
      execute: async (params) => passing(params),
    });

    expect(run.results).toHaveLength(2);
    expect((await readdir(join(resultsDirectory, 'proof', 'fixture'))).sort()).toEqual([
      '1.json',
      '2.json',
    ]);
    expect(await readdir(join(resultsDirectory, 'proof'))).toContain('summary.md');
  });

  it('lists the reason of an errored case in the summary', async () => {
    const root = await mkdtemp(join(tmpdir(), 'shipfox-eval-errors-'));
    temporaryDirectories.push(root);
    const resultsDirectory = join(root, 'results');

    await runEval({
      suite: 'templates',
      mode: 'scripted',
      repeat: 1,
      cwd: fileURLToPath(new URL('../', import.meta.url)),
      caseFilter: 'fixture',
      resultsDirectory,
      runId: 'errors',
      execute: async (params) => ({
        ...passing(params),
        status: 'error',
        error: 'Step 2 failed\nthe run ended failed',
      }),
    });

    const summary = await readFile(join(resultsDirectory, 'errors', 'summary.md'), 'utf8');
    expect(summary).toContain('- `fixture` repeat 1: Step 2 failed / the run ended failed');
  });

  it('runs only the cases that declare the mode', async () => {
    const root = await mkdtemp(join(tmpdir(), 'shipfox-eval-modes-'));
    temporaryDirectories.push(root);
    const executed: string[] = [];

    const run = await runEval({
      suite: 'templates',
      mode: 'live',
      cwd: fileURLToPath(new URL('../', import.meta.url)),
      resultsDirectory: join(root, 'results'),
      execute: (params) => {
        executed.push(params.discovered.id);
        return Promise.resolve({...passing(params), mode: 'live'});
      },
    });

    expect(run.results).toHaveLength(executed.length);
    expect(executed).toContain('ticket-to-pr/live-json-flag');
    expect(executed).not.toContain('ticket-to-pr/feedback-loop');
  });

  it('refuses a mode no selected case declares', async () => {
    await expect(
      runEval({
        suite: 'templates',
        mode: 'live',
        cwd: fileURLToPath(new URL('../', import.meta.url)),
        caseFilter: 'ticket-to-pr/feedback-loop',
        execute: async (params) => passing(params),
      }),
    ).rejects.toThrow(undeclaredModePattern);
  });

  it('stops starting case runs once the budget is spent', async () => {
    const root = await mkdtemp(join(tmpdir(), 'shipfox-eval-budget-'));
    temporaryDirectories.push(root);
    const resultsDirectory = join(root, 'results');

    const run = await runEval({
      suite: 'templates',
      mode: 'scripted',
      repeat: 4,
      maxCostUsd: 1,
      cwd: fileURLToPath(new URL('../', import.meta.url)),
      caseFilter: 'fixture',
      resultsDirectory,
      runId: 'budget',
      execute: async (params) => ({...passing(params), cost_usd: 0.6}),
    });

    expect(run.results).toHaveLength(2);
    expect(run.skipped_for_budget).toBe(2);
    expect(await readFile(join(resultsDirectory, 'budget', 'summary.md'), 'utf8')).toContain(
      'Not started, budget spent: 2',
    );
  });

  it('lists the live measures and hidden tests in the summary', async () => {
    const root = await mkdtemp(join(tmpdir(), 'shipfox-eval-live-summary-'));
    temporaryDirectories.push(root);
    const resultsDirectory = join(root, 'results');

    await runEval({
      suite: 'templates',
      mode: 'live',
      cwd: fileURLToPath(new URL('../', import.meta.url)),
      caseFilter: 'ticket-to-pr/live-json-flag',
      resultsDirectory,
      runId: 'live',
      execute: async (params) => ({
        ...passing(params),
        mode: 'live',
        duration_ms: 12_500,
        cost_usd: 0.25,
        measures: {
          input_tokens: 1200,
          output_tokens: 300,
          cache_read_tokens: 0,
          reasoning_tokens: 0,
          model_requests: 4,
          gate_retries: 1,
        },
        hidden_tests: {passed: true, exit_code: 0, output_tail: ''},
      }),
    });

    expect(await readFile(join(resultsDirectory, 'live', 'summary.md'), 'utf8')).toContain(
      '| `ticket-to-pr/live-json-flag` | 1 | passed | passed | 1200 | 300 | 1 | 12.5 | 0.2500 |',
    );
  });

  it('counts the passes of each case across its repeats in the summary', async () => {
    const root = await mkdtemp(join(tmpdir(), 'shipfox-eval-passes-'));
    temporaryDirectories.push(root);
    const resultsDirectory = join(root, 'results');

    await runEval({
      suite: 'templates',
      mode: 'scripted',
      cwd: fileURLToPath(new URL('../', import.meta.url)),
      caseFilter: 'fixture',
      repeat: 3,
      resultsDirectory,
      runId: 'passes',
      execute: async (params) => ({
        ...passing(params),
        status: params.repeat === 2 ? 'failed' : 'passed',
      }),
    });

    expect(await readFile(join(resultsDirectory, 'passes', 'summary.md'), 'utf8')).toContain(
      '| `fixture` | 2 of 3 |',
    );
  });
});

describe('exit code', () => {
  const result = (status: CaseResult['status']): CaseResult => ({
    ...passing({discovered: {id: 'case'}, repeat: 1}),
    status,
  });

  it('fails a scripted run on any case that did not pass', () => {
    expect(exitCodeFor({mode: 'scripted', results: [result('passed'), result('failed')]})).toBe(1);
    expect(exitCodeFor({mode: 'scripted', results: [result('passed')]})).toBe(0);
  });

  it('fails a live run only on cases that could not be run', () => {
    expect(exitCodeFor({mode: 'live', results: [result('passed'), result('failed')]})).toBe(0);
    expect(exitCodeFor({mode: 'live', results: [result('failed'), result('error')]})).toBe(1);
  });
});

describe('case scenario schema', () => {
  const base = {template: 'shipfox/fixture', expect: {}};

  it('rejects an unknown key under a manual start and accepts the corrected step', () => {
    const typo = [{start: {manual: {input: {title: 'x'}}}}];
    const fixed = [{start: {manual: {inputs: {title: 'x'}}}}];

    expect(() => parseTemplateCase({...base, scenario: typo})).toThrow(invalidScenarioPattern);
    expect(parseTemplateCase({...base, scenario: fixed}).scenario).toHaveLength(1);
  });

  it('rejects an event whose payload is not an object and accepts an object', () => {
    const start = {start: {manual: {}}};
    const scalar = [start, {send: {github: {'pull_request.closed': 5}}}];
    const object = [start, {send: {github: {'pull_request.closed': {merged: true}}}}];

    expect(() => parseTemplateCase({...base, scenario: scalar})).toThrow(invalidScenarioPattern);
    expect(parseTemplateCase({...base, scenario: object}).scenario).toHaveLength(2);
  });
});

describe('case seed schema', () => {
  const issue = {id: 'issue-1', identifier: 'ENG-7', title: 'Task', team: 'ENG'};
  const base = {template: 'shipfox/fixture', scenario: [{start: {manual: {}}}], expect: {}};

  it('rejects two seeded issues with the same identifier', () => {
    const seed = {linear: {issues: [issue, {...issue, id: 'issue-2'}]}};

    expect(() => parseTemplateCase({...base, seed})).toThrow(duplicatePattern);
  });

  it('accepts seeded issues with distinct identifiers', () => {
    const seed = {linear: {issues: [issue, {...issue, id: 'issue-2', identifier: 'ENG-8'}]}};

    expect(parseTemplateCase({...base, seed}).seed.linear?.issues).toHaveLength(2);
  });

  const message = {ts: '1.000100', user: 'U1', text: 'Where is it?'};

  it('accepts a seeded Slack thread', () => {
    const seed = {slack: {channel: 'C1', thread: [message]}};

    expect(parseTemplateCase({...base, seed}).seed.slack?.thread).toHaveLength(1);
  });

  it('rejects a seeded Slack thread with no messages', () => {
    const seed = {slack: {channel: 'C1', thread: []}};

    expect(() => parseTemplateCase({...base, seed})).toThrow(seedPattern);
  });

  it('accepts a replace-with placeholder and rejects any other name', () => {
    const accepted = {'replace-with-channel-id': 'C1'};

    expect(parseTemplateCase({...base, placeholders: accepted}).placeholders).toEqual(accepted);
    expect(() => parseTemplateCase({...base, placeholders: {channel: 'C1'}})).toThrow(
      placeholderPattern,
    );
  });

  it('rejects two seeded GitHub issues with the same number', () => {
    const github = {number: 1, title: 'Task'};
    const seed = {github: {issues: [github, {...github, title: 'Other'}]}};

    expect(() => parseTemplateCase({...base, seed})).toThrow(duplicateNumberPattern);
  });

  it('accepts seeded GitHub issues with distinct numbers', () => {
    const github = {number: 1, title: 'Task'};
    const seed = {github: {issues: [github, {...github, number: 2}]}};

    expect(parseTemplateCase({...base, seed}).seed.github?.issues).toHaveLength(2);
  });
});

describe('case ClickUp seed schema', () => {
  const task = {id: '86abc', name: 'Task', list: 'list-1'};
  const base = {template: 'shipfox/fixture', scenario: [{start: {manual: {}}}], expect: {}};

  it('rejects two seeded tasks with the same ID', () => {
    const seed = {clickup: {tasks: [task, {...task, name: 'Other'}]}};

    expect(() => parseTemplateCase({...base, seed})).toThrow(duplicateTaskPattern);
  });

  it('accepts seeded tasks with distinct IDs', () => {
    const seed = {clickup: {tasks: [task, {...task, id: '86abd'}]}};

    expect(parseTemplateCase({...base, seed}).seed.clickup?.tasks).toHaveLength(2);
  });
});
