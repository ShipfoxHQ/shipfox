#!/usr/bin/env node
import {join} from 'node:path';
import {parseArgs} from 'node:util';
import {caseSupportsMode, discoverCases} from './discovery.js';
import {exportToLangfuse, isLangfuseConfigured} from './langfuse.js';
import {type ResultsRun, writeResults} from './results.js';

const usage = `Usage: shipfox-eval-workflows [options]

Options:
  --suite <templates>       Suite to run (default: templates)
  --mode <scripted|live>    Evaluation mode (default: scripted)
  --case <pattern>          Case path or glob to run
  --repeat <count>          Number of repeats (default: 1)
  --max-cost-usd <amount>   Stop before exceeding this budget
  --help                    Show this help
`;

export interface EvalCliOptions {
  suite: 'templates' | 'onboarding';
  mode: 'scripted' | 'live';
  caseFilter?: string;
  repeat: number;
  maxCostUsd?: number;
}

export interface EvalCliEnvironment {
  cwd?: string;
  stdout?: (message: string) => void;
  stderr?: (message: string) => void;
}

function positiveInteger(value: string, option: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${option} must be a positive integer`);
  }
  return parsed;
}

function nonNegativeNumber(value: string, option: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${option} must be a non-negative number`);
  }
  return parsed;
}

export function parseEvalArgs(argv: string[]): EvalCliOptions & {help: boolean} {
  const {values} = parseArgs({
    args: argv,
    options: {
      suite: {type: 'string', default: 'templates'},
      mode: {type: 'string', default: 'scripted'},
      case: {type: 'string'},
      repeat: {type: 'string', default: '1'},
      'max-cost-usd': {type: 'string'},
      help: {type: 'boolean', short: 'h', default: false},
    },
    strict: true,
  });

  const suite = values.suite;
  if (suite !== 'templates' && suite !== 'onboarding') {
    throw new Error(`--suite must be templates or onboarding, received "${suite}"`);
  }
  const mode = values.mode;
  if (mode !== 'scripted' && mode !== 'live') {
    throw new Error(`--mode must be scripted or live, received "${mode}"`);
  }

  const options: EvalCliOptions & {help: boolean} = {
    help: values.help,
    suite,
    mode,
    repeat: positiveInteger(values.repeat, '--repeat'),
  };
  if (values.case !== undefined) options.caseFilter = values.case;
  if (values['max-cost-usd'] !== undefined) {
    options.maxCostUsd = nonNegativeNumber(values['max-cost-usd'], '--max-cost-usd');
  }
  return options;
}

function caseRoot(suite: EvalCliOptions['suite'], cwd: string): string {
  return join(cwd, 'cases', suite === 'templates' ? 'templates' : 'onboarding');
}

export interface EvalRunOptions extends EvalCliOptions {
  cwd?: string;
  resultsDirectory?: string;
  runId?: string;
}

export async function runEval(options: EvalRunOptions): Promise<ResultsRun> {
  const cwd = options.cwd ?? process.cwd();
  if (options.suite !== 'templates') {
    throw new Error('The onboarding suite is reserved for the onboarding case schema.');
  }
  // Results are written without executing cases, so a live run would report passes it never ran.
  if (options.mode === 'live') {
    throw new Error('Live mode is not available until cases execute against the stack.');
  }

  const discovered = await discoverCases(
    caseRoot(options.suite, cwd),
    options.caseFilter === undefined ? {} : {filter: options.caseFilter},
  );
  if (discovered.length === 0) {
    const selected = options.caseFilter ? ` matching "${options.caseFilter}"` : '';
    throw new Error(`No ${options.suite} cases${selected} were found.`);
  }

  const unsupported = discovered.filter(
    (entry) => !caseSupportsMode(entry.definition, options.mode),
  );
  if (unsupported.length > 0) {
    throw new Error(
      unsupported
        .map(
          (entry) =>
            `Case "${entry.id}" does not declare mode "${options.mode}" in its modes field.`,
        )
        .join('\n'),
    );
  }

  // Cost accounting is added by the execution layers. Keeping the option here means
  // scripted runs and future live runs share the same CLI contract.
  void options.maxCostUsd;
  return writeResults({
    cases: discovered,
    mode: options.mode,
    repeat: options.repeat,
    ...(options.resultsDirectory === undefined ? {} : {resultsDirectory: options.resultsDirectory}),
    ...(options.runId === undefined ? {} : {runId: options.runId}),
  });
}

// Results are already on disk, so an export failure is reported without failing the run.
async function exportRun({
  options,
  run,
  stdout,
  stderr,
}: {
  options: EvalCliOptions;
  run: ResultsRun;
  stdout: (message: string) => void;
  stderr: (message: string) => void;
}): Promise<void> {
  if (!isLangfuseConfigured()) return;
  try {
    const exported = await exportToLangfuse({
      suite: options.suite,
      mode: options.mode,
      run,
      metadata: {case_filter: options.caseFilter ?? null, repeat: options.repeat},
    });
    if (exported)
      stdout(`Exported ${exported.items} items to Langfuse as ${exported.experiment}.\n`);
  } catch (error) {
    stderr(`Langfuse export failed: ${error instanceof Error ? error.message : String(error)}\n`);
  }
}

export async function runCli(
  argv: string[],
  environment: EvalCliEnvironment = {},
): Promise<number> {
  const stdout = environment.stdout ?? ((message: string) => process.stdout.write(message));
  const stderr = environment.stderr ?? ((message: string) => process.stderr.write(message));

  try {
    const options = parseEvalArgs(argv);
    if (options.help) {
      stdout(usage);
      return 0;
    }
    const run = await runEval({
      suite: options.suite,
      mode: options.mode,
      repeat: options.repeat,
      ...(options.caseFilter === undefined ? {} : {caseFilter: options.caseFilter}),
      ...(options.maxCostUsd === undefined ? {} : {maxCostUsd: options.maxCostUsd}),
      ...(environment.cwd === undefined ? {} : {cwd: environment.cwd}),
      ...(environment.cwd === undefined ? {} : {resultsDirectory: `${environment.cwd}/results`}),
    });
    stdout(`Validated ${run.results.length} case runs. Results: ${run.directory}\n`);
    await exportRun({options, run, stdout, stderr});
    return 0;
  } catch (error) {
    stderr(`Eval failed: ${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

if (process.argv[1]?.endsWith('/cli.js') || process.argv[1]?.endsWith('/cli.ts')) {
  runCli(process.argv.slice(2)).then((exitCode) => {
    if (exitCode !== 0) process.exitCode = exitCode;
  });
}
