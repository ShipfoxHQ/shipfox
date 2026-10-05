import {mkdir, writeFile} from 'node:fs/promises';
import {dirname, join} from 'node:path';
import type {RecordedWrite} from '@shipfox/e2e-core';
import type {WorkflowRunObservation} from '@shipfox/e2e-observe-workflows';
import type {ScriptedManagedProviderRequest} from '@shipfox/e2e-setup-agent';
import type {HiddenTestsResult} from './hidden-tests.js';
import type {RunMeasures} from './measures.js';
import type {ScenarioStepRecord} from './scenario.js';

/** `compile` only creates each variant's definition, and runs nothing. */
export type EvalMode = 'scripted' | 'live' | 'compile';

/** The session of one agent step, as the harness wrote it. */
export interface AgentTranscript {
  step: string;
  harness: 'pi' | 'claude';
  jsonl: string;
}

export interface CaseResult {
  case: string;
  mode: EvalMode;
  repeat: number;
  /** `failed` ran to the end but missed its expectations. `error` could not finish. */
  status: 'passed' | 'failed' | 'error';
  duration_ms: number;
  cost_usd: number;
  error?: string;
  composed_yaml?: string;
  agent_transcripts?: AgentTranscript[];
  run_id?: string;
  /** Each scenario step that ran, in order, with its outcome. */
  steps?: ScenarioStepRecord[];
  /** The run with its jobs, executions, and steps, once the scenario finished. */
  observation?: WorkflowRunObservation;
  /** Every write the fakes recorded, in arrival order. */
  writes?: RecordedWrite[];
  /** Live runs: the tokens the run used and how often a gate sent a step back. */
  measures?: RunMeasures;
  /** Live runs: the case's hidden tests, run on the branch the run pushed. */
  hidden_tests?: HiddenTestsResult;
  /** The case runner's log file. */
  runner_log?: string;
  /** On failure, the requests the scripted model provider served, with their prompts' ends. */
  model_requests?: ScriptedManagedProviderRequest[];
  /** On failure, the last lines of the case runner's log. */
  runner_log_tail?: string;
}

export interface ResultsRun {
  runId: string;
  directory: string;
  results: CaseResult[];
  /** Case repeats left unstarted because the run's budget was spent. */
  skipped_for_budget?: number;
}

export interface WriteResultsOptions<Case extends {id: string}> {
  cases: readonly Case[];
  mode: EvalMode;
  repeat: number;
  /** Runs one case repeat. It must not throw; a case that can't finish is an `error` result. */
  execute: (params: {discovered: Case; repeat: number}) => Promise<CaseResult>;
  /** Stops starting case repeats once the results so far cost this much. */
  maxCostUsd?: number | undefined;
  /** How many case repeats run at once (default 1). */
  workers?: number | undefined;
  resultsDirectory?: string;
  runId?: string;
}

/** Whether the repeats so far have spent the run's budget, so no new repeat should start. */
export function outOfBudget({
  results,
  maxCostUsd,
}: {
  results: Array<{cost_usd: number}>;
  maxCostUsd: number | undefined;
}): boolean {
  if (maxCostUsd === undefined) return false;
  return results.reduce((total, result) => total + result.cost_usd, 0) >= maxCostUsd;
}

export function createRunId(now = new Date()): string {
  return now.toISOString().replace(/[:.]/gu, '-');
}

function resultPath(runDirectory: string, result: CaseResult): string {
  return join(runDirectory, result.case, `${result.repeat}.json`);
}

const tableHeader = ['| Case | Repeat | Status | Cost (USD) |', '| --- | ---: | --- | ---: |'];
const liveTableHeader = [
  '| Case | Repeat | Status | Hidden tests | Tokens in | Tokens out | Gate retries | Duration (s) | Cost (USD) |',
  '| --- | ---: | --- | --- | ---: | ---: | ---: | ---: | ---: |',
];

function row(result: CaseResult): string {
  return `| \`${result.case}\` | ${result.repeat} | ${result.status} | ${result.cost_usd.toFixed(4)} |`;
}

function liveRow(result: CaseResult): string {
  const {measures, hidden_tests: hiddenTests} = result;
  let hidden = '-';
  if (hiddenTests !== undefined) hidden = hiddenTests.passed ? 'passed' : 'failed';
  return `| \`${result.case}\` | ${result.repeat} | ${result.status} | ${hidden} | ${measures?.input_tokens ?? '-'} | ${measures?.output_tokens ?? '-'} | ${measures?.gate_retries ?? '-'} | ${(result.duration_ms / 1000).toFixed(1)} | ${result.cost_usd.toFixed(4)} |`;
}

/** One row per case, so a case that passes only some of its repeats stands out. */
function passesPerCase(results: CaseResult[]): string[] {
  const counts = new Map<string, {passed: number; total: number}>();
  for (const result of results) {
    const count = counts.get(result.case) ?? {passed: 0, total: 0};
    count.total += 1;
    if (result.status === 'passed') count.passed += 1;
    counts.set(result.case, count);
  }
  return [
    '## Passes per case',
    '',
    '| Case | Passed |',
    '| --- | ---: |',
    ...[...counts].map(([id, {passed, total}]) => `| \`${id}\` | ${passed} of ${total} |`),
    '',
  ];
}

function summaryMarkdown(run: ResultsRun, mode: EvalMode): string {
  const passed = run.results.filter((result) => result.status === 'passed').length;
  const failed = run.results.filter((result) => result.status === 'failed').length;
  const errors = run.results.length - passed - failed;
  const lines = [
    '# Eval results',
    '',
    `- Run: \`${run.runId}\``,
    `- Mode: \`${mode}\``,
    `- Cases: ${run.results.length}`,
    `- Passed: ${passed}`,
    `- Failed: ${failed}`,
    `- Errors: ${errors}`,
    ...(run.skipped_for_budget ? [`- Not started, budget spent: ${run.skipped_for_budget}`] : []),
    '',
    ...passesPerCase(run.results),
    ...(mode === 'live' ? liveTableHeader : tableHeader),
  ];
  const failures = run.results.filter((result) => result.error !== undefined);

  for (const result of run.results) {
    lines.push(mode === 'live' ? liveRow(result) : row(result));
  }

  if (failures.length > 0) {
    lines.push('', '## Failures', '');
    for (const result of failures) {
      lines.push(
        `- \`${result.case}\` repeat ${result.repeat}: ${result.error?.replaceAll('\n', ' / ')}`,
      );
    }
  }

  return `${lines.join('\n')}\n`;
}

/** Runs every case repeat, writes one JSON result each, and writes a summary for the run. */
export async function writeResults<Case extends {id: string}>(
  options: WriteResultsOptions<Case>,
): Promise<ResultsRun> {
  const runId = options.runId ?? createRunId();
  const directory = join(options.resultsDirectory ?? 'results', runId);
  const jobs = options.cases.flatMap((discoveredCase) =>
    Array.from({length: options.repeat}, (_, index) => ({discoveredCase, repeat: index + 1})),
  );
  // Results land in the order the case repeats finish. The slots keep the summary in case order.
  const slots: Array<CaseResult | undefined> = jobs.map(() => undefined);
  const finished: CaseResult[] = [];
  let next = 0;

  // A case repeat in flight has not spent anything yet, so with several workers the budget can
  // be passed by up to one case repeat per worker.
  const work = async () => {
    while (next < jobs.length) {
      const index = next;
      next += 1;
      const job = jobs[index] as (typeof jobs)[number];
      if (outOfBudget({results: finished, maxCostUsd: options.maxCostUsd})) continue;
      const result = await options.execute({discovered: job.discoveredCase, repeat: job.repeat});
      finished.push(result);
      slots[index] = result;
      const path = resultPath(directory, result);
      await mkdir(dirname(path), {recursive: true});
      await writeFile(path, `${JSON.stringify(result, null, 2)}\n`);
    }
  };
  const workers = Math.max(1, Math.min(options.workers ?? 1, jobs.length));
  await Promise.all(Array.from({length: workers}, work));

  const results = slots.filter((result): result is CaseResult => result !== undefined);
  const skipped = jobs.length - results.length;

  const run: ResultsRun = {
    runId,
    directory,
    results,
    ...(skipped === 0 ? {} : {skipped_for_budget: skipped}),
  };
  await mkdir(directory, {recursive: true});
  await writeFile(join(directory, 'summary.md'), summaryMarkdown(run, options.mode));
  return run;
}
