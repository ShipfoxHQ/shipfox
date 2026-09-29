import {mkdir, writeFile} from 'node:fs/promises';
import {dirname, join} from 'node:path';
import type {DiscoveredCase} from './discovery.js';

export interface CaseResult {
  case: string;
  mode: 'scripted' | 'live';
  repeat: number;
  status: 'passed' | 'error';
  duration_ms: number;
  cost_usd: number;
  error?: string;
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

  for (const result of run.results) {
    lines.push(
      `| \`${result.case}\` | ${result.repeat} | ${result.status} | ${result.cost_usd.toFixed(4)} |`,
    );
  }

  return `${lines.join('\n')}\n`;
}

/** Writes one JSON result per case/repeat and a summary for the complete run. */
export async function writeResults(options: WriteResultsOptions): Promise<ResultsRun> {
  const runId = options.runId ?? createRunId();
  const directory = join(options.resultsDirectory ?? 'results', runId);
  const results: CaseResult[] = [];

  for (const discoveredCase of options.cases) {
    for (let repeat = 1; repeat <= options.repeat; repeat += 1) {
      const result: CaseResult = {
        case: discoveredCase.id,
        mode: options.mode,
        repeat,
        status: 'passed',
        duration_ms: 0,
        cost_usd: 0,
      };
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
