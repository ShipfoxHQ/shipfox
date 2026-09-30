import {mkdir, writeFile} from 'node:fs/promises';
import {dirname, join} from 'node:path';
import type {WorkflowRunObservation} from '@shipfox/e2e-observe-workflows';
import type {DiscoveredCase} from './discovery.js';
import type {ScenarioStepRecord} from './scenario.js';

/** The session of one agent step, as the harness wrote it. */
export interface AgentTranscript {
  step: string;
  harness: 'pi' | 'claude';
  jsonl: string;
}

export interface CaseResult {
  case: string;
  mode: 'scripted' | 'live';
  repeat: number;
  status: 'passed' | 'error';
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
  /** The case runner's log file. */
  runner_log?: string;
}

export interface ResultsRun {
  runId: string;
  directory: string;
  results: CaseResult[];
}

export interface WriteResultsOptions {
  cases: DiscoveredCase[];
  mode: 'scripted' | 'live';
  repeat: number;
  /** Runs one case repeat. It must not throw; a case that can't finish is an `error` result. */
  execute: (params: {discovered: DiscoveredCase; repeat: number}) => Promise<CaseResult>;
  resultsDirectory?: string;
  runId?: string;
}

export function createRunId(now = new Date()): string {
  return now.toISOString().replace(/[:.]/gu, '-');
}

function resultPath(runDirectory: string, result: CaseResult): string {
  return join(runDirectory, result.case, `${result.repeat}.json`);
}

function summaryMarkdown(run: ResultsRun, mode: 'scripted' | 'live'): string {
  const passed = run.results.filter((result) => result.status === 'passed').length;
  const errors = run.results.length - passed;
  const lines = [
    '# Eval results',
    '',
    `- Run: \`${run.runId}\``,
    `- Mode: \`${mode}\``,
    `- Cases: ${run.results.length}`,
    `- Passed: ${passed}`,
    `- Errors: ${errors}`,
    '',
    '| Case | Repeat | Status | Cost (USD) |',
    '| --- | ---: | --- | ---: |',
  ];
  const failures = run.results.filter((result) => result.error !== undefined);

  for (const result of run.results) {
    lines.push(
      `| \`${result.case}\` | ${result.repeat} | ${result.status} | ${result.cost_usd.toFixed(4)} |`,
    );
  }

  if (failures.length > 0) {
    lines.push('', '## Errors', '');
    for (const result of failures) {
      lines.push(
        `- \`${result.case}\` repeat ${result.repeat}: ${result.error?.replaceAll('\n', ' / ')}`,
      );
    }
  }

  return `${lines.join('\n')}\n`;
}

/** Runs every case repeat, writes one JSON result each, and writes a summary for the run. */
export async function writeResults(options: WriteResultsOptions): Promise<ResultsRun> {
  const runId = options.runId ?? createRunId();
  const directory = join(options.resultsDirectory ?? 'results', runId);
  const results: CaseResult[] = [];

  for (const discoveredCase of options.cases) {
    for (let repeat = 1; repeat <= options.repeat; repeat += 1) {
      const result = await options.execute({discovered: discoveredCase, repeat});
      results.push(result);
      const path = resultPath(directory, result);
      await mkdir(dirname(path), {recursive: true});
      await writeFile(path, `${JSON.stringify(result, null, 2)}\n`);
    }
  }

  const run = {runId, directory, results};
  await mkdir(directory, {recursive: true});
  await writeFile(join(directory, 'summary.md'), summaryMarkdown(run, options.mode));
  return run;
}
