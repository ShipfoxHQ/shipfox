#!/usr/bin/env node
import {join} from 'node:path';
import {parseArgs} from 'node:util';
import {preflightCheck} from '@shipfox/e2e-core';
import {shippedTemplateLoader} from '@shipfox/workflow-templates';
import {runCompile} from './compile.js';
import {runContractsCompile} from './contracts-compile.js';
import {checkTemplateCoverage} from './coverage.js';
import {caseSupportsMode, type DiscoveredCase, discoverCases} from './discovery.js';
import {executeTemplateCase} from './execute.js';
import {exportToLangfuse, isLangfuseConfigured} from './langfuse.js';
import {runOnboardingSuite} from './onboarding-run.js';
import {
  type CaseResult,
  createRunId,
  type EvalMode,
  type ResultsRun,
  writeResults,
} from './results.js';
import type {EventSenders} from './senders.js';
import {type DiscoveredShippyCase, discoverShippyCases, executeShippyCase} from './shippy-run.js';

const usage = `Usage: shipfox-eval-workflows [options]

Options:
  --suite <templates|shippy|onboarding|contracts>
                            Suite to run (default: templates). shippy drives the
                            project agent through conversations. contracts runs in
                            compile mode only.
  --mode <scripted|live|compile>
                            Evaluation mode (default: scripted, compile for contracts).
                            compile creates a definition for every template variant, or
                            for every contract workflow file, and runs nothing.
  --case <pattern>          Case path or glob to run, a template id in compile mode, or a
                            workflow file name for the contracts suite
  --catalog <directory>     Compile the templates of a catalog directory instead of the
                            shipped ones (templates compile mode only)
  --repeat <count>          Number of repeats (default: 1; the case's k for onboarding
                            and live shippy runs)
  --workers <count>         Case repeats to run at once (default: 4; scripted and live
                            template and shippy runs only)
  --max-cost-usd <amount>   Stop starting cases once the runs so far have cost this much
                            (live and onboarding runs)
  --agent-model <model>     Model of the onboarding agent, or the catalog model that
                            answers Shippy in live mode (onboarding and shippy only)
  --simulator-model <model> Model of the simulated user (onboarding suite only)
  --help                    Show this help
`;

export type EvalSuite = 'templates' | 'shippy' | 'onboarding' | 'contracts';

export interface EvalCliOptions {
  suite: EvalSuite;
  mode: EvalMode;
  caseFilter?: string;
  catalog?: string;
  /** Unset, templates run once and onboarding cases run their own `k`. */
  repeat?: number;
  maxCostUsd?: number;
  /** Template and shippy runs only. The command line defaults to `DEFAULT_WORKERS`, `runEval` to one. */
  workers?: number;
  agentModel?: string;
  simulatorModel?: string;
}

export interface EvalCliEnvironment {
  cwd?: string;
  stdout?: (message: string) => void;
  stderr?: (message: string) => void;
}

/** Each case has its own workspace, runner, and fake credentials, so cases don't interfere. */
export const DEFAULT_WORKERS = 4;

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

// Only template and shippy runs have cases to spread over workers.
function parseWorkers({
  workers,
  suite,
  mode,
}: {
  workers: string | undefined;
  suite: EvalCliOptions['suite'];
  mode: EvalMode;
}): number | undefined {
  const spreads = (suite === 'templates' || suite === 'shippy') && mode !== 'compile';
  if (workers === undefined) return spreads ? DEFAULT_WORKERS : undefined;
  if (!spreads) {
    throw new Error('--workers applies to scripted and live template and shippy runs only');
  }
  return positiveInteger(workers, '--workers');
}

// Template cases run each template's own anchor models, so only onboarding and Shippy take one.
function applyModelOptions({
  options,
  agentModel,
  simulatorModel,
}: {
  options: EvalCliOptions;
  agentModel: string | undefined;
  simulatorModel: string | undefined;
}): void {
  if (agentModel === undefined && simulatorModel === undefined) return;
  if (simulatorModel !== undefined && options.suite !== 'onboarding') {
    throw new Error('--simulator-model applies to --suite onboarding only');
  }
  if (options.suite !== 'onboarding' && options.suite !== 'shippy') {
    throw new Error('--agent-model applies to --suite onboarding and shippy only');
  }
  if (agentModel !== undefined) options.agentModel = agentModel;
  if (simulatorModel !== undefined) options.simulatorModel = simulatorModel;
}

function assertCompatible({
  suite,
  mode,
  catalog,
}: {
  suite: EvalCliOptions['suite'];
  mode: EvalMode;
  catalog: string | undefined;
}): void {
  if ((suite === 'onboarding' || suite === 'shippy') && mode === 'compile') {
    throw new Error('--mode compile applies to --suite templates and contracts only');
  }
  if (suite === 'contracts' && mode !== 'compile') {
    throw new Error('--suite contracts runs with --mode compile only');
  }
  if (catalog !== undefined && (mode !== 'compile' || suite !== 'templates')) {
    throw new Error('--catalog applies to --suite templates --mode compile only');
  }
}

export function parseEvalArgs(argv: string[]): EvalCliOptions & {help: boolean} {
  const {values} = parseArgs({
    args: argv,
    options: {
      suite: {type: 'string', default: 'templates'},
      mode: {type: 'string'},
      case: {type: 'string'},
      catalog: {type: 'string'},
      repeat: {type: 'string'},
      'max-cost-usd': {type: 'string'},
      workers: {type: 'string'},
      'agent-model': {type: 'string'},
      'simulator-model': {type: 'string'},
      help: {type: 'boolean', short: 'h', default: false},
    },
    strict: true,
  });

  const suite = values.suite;
  if (
    suite !== 'templates' &&
    suite !== 'shippy' &&
    suite !== 'onboarding' &&
    suite !== 'contracts'
  ) {
    throw new Error(
      `--suite must be templates, shippy, onboarding, or contracts, received "${suite}"`,
    );
  }
  const mode = values.mode ?? (suite === 'contracts' ? 'compile' : 'scripted');
  if (mode !== 'scripted' && mode !== 'live' && mode !== 'compile') {
    throw new Error(`--mode must be scripted, live, or compile, received "${mode}"`);
  }
  assertCompatible({suite, mode, catalog: values.catalog});

  const options: EvalCliOptions & {help: boolean} = {
    help: values.help,
    suite,
    mode,
  };
  if (values.repeat !== undefined) options.repeat = positiveInteger(values.repeat, '--repeat');
  const workers = parseWorkers({workers: values.workers, suite, mode});
  if (workers !== undefined) options.workers = workers;
  if (values.case !== undefined) options.caseFilter = values.case;
  if (values.catalog !== undefined) options.catalog = values.catalog;
  if (values['max-cost-usd'] !== undefined) {
    options.maxCostUsd = nonNegativeNumber(values['max-cost-usd'], '--max-cost-usd');
  }
  applyModelOptions({
    options,
    agentModel: values['agent-model'],
    simulatorModel: values['simulator-model'],
  });
  return options;
}

function caseRoot(suite: 'templates' | 'shippy' | 'onboarding', cwd: string): string {
  return join(cwd, 'cases', suite);
}

export interface EvalRunOptions extends EvalCliOptions {
  /** Shippy suite: replaces the case executor, so a test can see what the run passes it. */
  executeCase?: typeof executeShippyCase;
  cwd?: string;
  resultsDirectory?: string;
  runId?: string;
  /** Replaces case execution against the running stack, which tests don't have. */
  execute?: (params: {discovered: DiscoveredCase; repeat: number}) => Promise<CaseResult>;
  senders?: EventSenders;
}

/** The executor of a shippy case against the stack, unless a test replaces the case executor. */
async function shippyExecutor({
  options,
  mode,
  workDirectory,
}: {
  options: Pick<EvalRunOptions, 'agentModel' | 'executeCase'>;
  mode: 'scripted' | 'live';
  workDirectory: string;
}): Promise<(params: {discovered: DiscoveredShippyCase; repeat: number}) => Promise<CaseResult>> {
  if (options.executeCase === undefined) await preflightCheck({requireClient: false});
  const executeCase = options.executeCase ?? executeShippyCase;
  return ({discovered, repeat}) =>
    executeCase({discovered, mode, repeat, workDirectory, model: options.agentModel});
}

/**
 * Runs the shippy cases that declare the mode, each in a workspace of its own, and writes one
 * result per repeat. Scripted mode needs each case's `scripted.yaml`; live mode needs OpenRouter.
 */
export async function runShippyEval(
  options: Omit<EvalRunOptions, 'suite' | 'execute' | 'senders'> & {
    execute?: (params: {discovered: DiscoveredShippyCase; repeat: number}) => Promise<CaseResult>;
    /** Replaces the case executor, so a test can see what the run passes it. */
    executeCase?: typeof executeShippyCase;
  },
): Promise<ResultsRun> {
  const cwd = options.cwd ?? process.cwd();
  const {mode} = options;
  if (mode === 'compile') throw new Error('The shippy suite runs in scripted or live mode only.');
  const found = await discoverShippyCases(
    caseRoot('shippy', cwd),
    options.caseFilter === undefined ? {} : {filter: options.caseFilter},
  );
  if (found.length === 0) {
    const selected = options.caseFilter ? ` matching "${options.caseFilter}"` : '';
    throw new Error(`No shippy cases${selected} were found.`);
  }
  const discovered = found.filter((entry) => entry.definition.modes.includes(mode));
  if (discovered.length === 0) {
    throw new Error(
      found
        .map((entry) => `Case "${entry.id}" does not declare mode "${mode}" in its modes field.`)
        .join('\n'),
    );
  }

  const runId = options.runId ?? createRunId();
  const execute =
    options.execute ??
    (await shippyExecutor({options, mode, workDirectory: join(cwd, '.eval-run', runId)}));
  // A scripted conversation is deterministic, so it runs once unless asked otherwise.
  return writeResults<DiscoveredShippyCase>({
    cases: discovered,
    mode,
    repeat: options.repeat ?? 1,
    ...(options.repeat === undefined && mode === 'live'
      ? {repeatsOf: (entry) => entry.definition.k}
      : {}),
    execute,
    runId,
    maxCostUsd: options.maxCostUsd,
    workers: options.workers,
    ...(options.resultsDirectory === undefined ? {} : {resultsDirectory: options.resultsDirectory}),
  });
}

export async function runEval(options: EvalRunOptions): Promise<ResultsRun> {
  const cwd = options.cwd ?? process.cwd();
  if (options.suite === 'onboarding') {
    throw new Error('The onboarding suite runs through runOnboardingSuite.');
  }
  if (options.suite === 'contracts') {
    throw new Error('The contracts suite runs through runContractsCompile.');
  }
  if (options.suite === 'shippy') {
    // The template executor and event senders don't apply to a conversation.
    const {execute: _execute, senders: _senders, suite: _suite, ...shippyOptions} = options;
    return await runShippyEval(shippyOptions);
  }
  const {mode} = options;
  if (mode === 'compile') throw new Error('Compile mode runs through runCompile.');
  const found = await discoverCases(
    caseRoot(options.suite, cwd),
    options.caseFilter === undefined ? {} : {filter: options.caseFilter},
  );
  if (found.length === 0) {
    const selected = options.caseFilter ? ` matching "${options.caseFilter}"` : '';
    throw new Error(`No ${options.suite} cases${selected} were found.`);
  }

  // A live-only case has no script, so scripted runs leave it out, and the other way around.
  const discovered = found.filter((entry) => caseSupportsMode(entry.definition, mode));
  if (discovered.length === 0) {
    throw new Error(
      found
        .map((entry) => `Case "${entry.id}" does not declare mode "${mode}" in its modes field.`)
        .join('\n'),
    );
  }

  const runId = options.runId ?? createRunId();
  let execute = options.execute;
  if (execute === undefined) {
    await preflightCheck({requireClient: false});
    const workDirectory = join(cwd, '.eval-run', runId);
    execute = ({discovered: entry, repeat}) =>
      executeTemplateCase({
        discovered: entry,
        mode,
        repeat,
        workDirectory,
        senders: options.senders,
      });
  }
  return writeResults({
    cases: discovered,
    mode,
    repeat: options.repeat ?? 1,
    execute,
    runId,
    maxCostUsd: options.maxCostUsd,
    workers: options.workers,
    ...(options.resultsDirectory === undefined ? {} : {resultsDirectory: options.resultsDirectory}),
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
  const {mode} = options;
  // Only template runs have scores to export.
  if (mode === 'compile' || !isLangfuseConfigured()) return;
  try {
    const exported = await exportToLangfuse({
      suite: options.suite,
      mode,
      run,
      metadata: {case_filter: options.caseFilter ?? null, repeat: options.repeat ?? 1},
    });
    if (exported)
      stdout(`Exported ${exported.items} items to Langfuse as ${exported.experiment}.\n`);
  } catch (error) {
    stderr(`Langfuse export failed: ${error instanceof Error ? error.message : String(error)}\n`);
  }
}

// Scores never fail a run, so only cases that could not be run at all make the exit code non-zero.
async function runOnboardingCli({
  options,
  stdout,
  stderr,
}: {
  options: EvalCliOptions;
  stdout: (message: string) => void;
  stderr: (message: string) => void;
}): Promise<number> {
  const run = await runOnboardingSuite({
    ...(options.caseFilter === undefined ? {} : {caseFilter: options.caseFilter}),
    ...(options.repeat === undefined ? {} : {repeat: options.repeat}),
    ...(options.maxCostUsd === undefined ? {} : {maxCostUsd: options.maxCostUsd}),
    ...(options.agentModel === undefined ? {} : {agentModel: options.agentModel}),
    ...(options.simulatorModel === undefined ? {} : {simulatorModel: options.simulatorModel}),
  });
  stdout(`Ran ${run.results.length} onboarding sessions. Results: ${run.directory}\n`);
  const failed = run.results.filter((result) => result.status === 'error');
  for (const result of failed) {
    stderr(`${result.case} #${result.repeat}: ${result.error ?? 'failed'}\n`);
  }
  return failed.length === 0 ? 0 : 1;
}

// Every variant that does not compile is reported, so one run shows all the broken wiring.
async function runCompileCli({
  options,
  stdout,
  stderr,
  cwd,
}: {
  options: EvalCliOptions;
  stdout: (message: string) => void;
  stderr: (message: string) => void;
  cwd?: string | undefined;
}): Promise<number> {
  const run = await runCompile({
    ...(options.caseFilter === undefined ? {} : {caseFilter: options.caseFilter}),
    ...(options.catalog === undefined ? {} : {catalog: options.catalog}),
    ...(cwd === undefined ? {} : {cwd, resultsDirectory: `${cwd}/results`}),
  });
  const failed = run.results.filter((result) => result.status === 'error');
  stdout(
    `Compiled ${run.results.length} template variants, ${failed.length} failed. Results: ${run.directory}\n`,
  );
  for (const result of failed) {
    stderr(`${result.case}:\n${result.error}\n`);
  }
  return failed.length === 0 ? 0 : 1;
}

// Every file that does not compile is reported, so one run shows all that would fail the sync.
async function runContractsCompileCli({
  options,
  stdout,
  stderr,
  cwd,
}: {
  options: EvalCliOptions;
  stdout: (message: string) => void;
  stderr: (message: string) => void;
  cwd?: string | undefined;
}): Promise<number> {
  const run = await runContractsCompile({
    ...(options.caseFilter === undefined ? {} : {caseFilter: options.caseFilter}),
    ...(cwd === undefined ? {} : {resultsDirectory: `${cwd}/results`}),
  });
  const failed = run.results.filter((result) => result.status === 'error');
  stdout(
    `Compiled ${run.results.length} contract workflows, ${failed.length} failed. Results: ${run.directory}\n`,
  );
  for (const result of failed) {
    stderr(`${result.case}:\n${result.error}\n`);
  }
  return failed.length === 0 ? 0 : 1;
}

// A filtered run cannot judge the whole suite, so only a full scripted run checks coverage. It
// reads files only, so it runs before the stack preflight and a missing case fails fast.
async function coverageHolds({
  options,
  cwd,
  stdout,
  stderr,
}: {
  options: EvalCliOptions;
  cwd: string;
  stdout: (message: string) => void;
  stderr: (message: string) => void;
}): Promise<boolean> {
  if (options.suite !== 'templates' || options.mode !== 'scripted' || options.caseFilter) {
    return true;
  }
  const root = caseRoot('templates', cwd);
  const coverage = await checkTemplateCoverage({
    casesRoot: root,
    loader: shippedTemplateLoader,
    cases: await discoverCases(root),
  });
  if (coverage.pending.length > 0) {
    stdout(`Pending, no behaviors.yaml yet: ${coverage.pending.join(', ')}\n`);
  }
  for (const problem of coverage.problems) stderr(`${problem}\n`);
  return coverage.problems.length === 0;
}

/** Scripted cases block CI. Live scores never fail a run, only cases that could not be run. */
export function exitCodeFor({mode, results}: {mode: EvalMode; results: CaseResult[]}): number {
  const blocking =
    mode === 'live'
      ? results.filter((result) => result.status === 'error')
      : results.filter((result) => result.status !== 'passed');
  return blocking.length > 0 ? 1 : 0;
}

async function runCasesCli({
  options,
  cwd,
  stdout,
  stderr,
}: {
  options: EvalCliOptions;
  cwd?: string | undefined;
  stdout: (message: string) => void;
  stderr: (message: string) => void;
}): Promise<number> {
  if (!(await coverageHolds({options, cwd: cwd ?? process.cwd(), stdout, stderr}))) return 1;
  const run = await runEval({
    suite: options.suite,
    mode: options.mode,
    ...(options.repeat === undefined ? {} : {repeat: options.repeat}),
    ...(options.caseFilter === undefined ? {} : {caseFilter: options.caseFilter}),
    ...(options.maxCostUsd === undefined ? {} : {maxCostUsd: options.maxCostUsd}),
    ...(options.workers === undefined ? {} : {workers: options.workers}),
    ...(options.agentModel === undefined ? {} : {agentModel: options.agentModel}),
    ...(cwd === undefined ? {} : {cwd, resultsDirectory: `${cwd}/results`}),
  });
  const failed = run.results.filter((result: CaseResult) => result.status !== 'passed');
  stdout(
    `Ran ${run.results.length} case runs, ${failed.length} not passed. Results: ${run.directory}\n`,
  );
  if (run.skipped_for_budget) {
    stdout(`Budget spent: ${run.skipped_for_budget} case runs were not started.\n`);
  }
  for (const result of failed) {
    stderr(`${result.case} (repeat ${result.repeat}): ${result.error}\n`);
  }
  await exportRun({options, run, stdout, stderr});
  return exitCodeFor({mode: options.mode, results: run.results});
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
    if (options.suite === 'onboarding') return await runOnboardingCli({options, stdout, stderr});
    if (options.suite === 'contracts') {
      return await runContractsCompileCli({options, stdout, stderr, cwd: environment.cwd});
    }
    if (options.mode === 'compile') {
      return await runCompileCli({options, stdout, stderr, cwd: environment.cwd});
    }
    return await runCasesCli({options, cwd: environment.cwd, stdout, stderr});
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
