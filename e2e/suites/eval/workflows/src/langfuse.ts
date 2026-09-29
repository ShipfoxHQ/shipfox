import {execFile} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {promisify} from 'node:util';
import {type Evaluation, type ExperimentItem, LangfuseClient} from '@langfuse/client';
import {LangfuseSpanProcessor} from '@langfuse/otel';
import {startActiveObservation} from '@langfuse/tracing';
import {NodeTracerProvider} from '@opentelemetry/sdk-trace-node';
import type {CaseResult, ResultsRun} from './results.js';

const execFileAsync = promisify(execFile);

type LangfuseEnvironment = Record<string, string | undefined>;

interface ItemInput {
  case: string;
  repeat: number;
}

type ResultLookup = Map<string, CaseResult>;

/** The exporter is off unless both keys are set, so contributors without keys keep local results. */
export function isLangfuseConfigured(env: LangfuseEnvironment = process.env): boolean {
  return Boolean(env.LANGFUSE_PUBLIC_KEY) && Boolean(env.LANGFUSE_SECRET_KEY);
}

function itemKey({case: caseId, repeat}: ItemInput): string {
  return `${caseId}#${repeat}`;
}

function base64DataUri({contentType, text}: {contentType: string; text: string}): string {
  return `data:${contentType};base64,${Buffer.from(text, 'utf8').toString('base64')}`;
}

/**
 * Item input is only the case and repeat. Langfuse derives the item id from the input, so any
 * run-specific value here would stop two runs from lining up item by item.
 */
export function buildExperimentItems(results: CaseResult[]): ExperimentItem<ItemInput>[] {
  return results.map((result) => ({input: {case: result.case, repeat: result.repeat}}));
}

/**
 * Langfuse drops an item whose task throws, so every failure becomes an `error` result instead.
 */
export function safeTask({
  results,
  summary,
}: {
  results: ResultLookup;
  summary: string;
}): (item: ExperimentItem<ItemInput>) => Promise<unknown> {
  return (item) => {
    const input = item.input as ItemInput;
    try {
      const result = results.get(itemKey(input));
      if (!result) throw new Error(`No result was recorded for ${itemKey(input)}.`);
      // The span processor uploads base64 data URIs found in a span's output as media.
      const media: Record<string, string> = {
        summary: base64DataUri({contentType: 'text/markdown', text: summary}),
      };
      if (result.composed_yaml !== undefined) {
        media.composed_yaml = base64DataUri({
          contentType: 'application/x-yaml',
          text: result.composed_yaml,
        });
      }
      const {composed_yaml: _yaml, ...rest} = result;
      return Promise.resolve({...rest, media});
    } catch (error) {
      return Promise.resolve({
        case: input.case,
        repeat: input.repeat,
        status: 'error',
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };
}

function flattenScores({
  prefix,
  value,
  scores,
}: {
  prefix: string;
  value: unknown;
  scores: Evaluation[];
}): void {
  if (typeof value === 'boolean') {
    scores.push({name: prefix, value: value ? 1 : 0, dataType: 'BOOLEAN'});
  } else if (typeof value === 'number' && Number.isFinite(value)) {
    scores.push({name: prefix, value, dataType: 'NUMERIC'});
  } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    for (const [key, child] of Object.entries(value)) {
      flattenScores({prefix: `${prefix}.${key}`, value: child, scores});
    }
  }
}

const identityFields = new Set(['case', 'mode', 'repeat', 'status', 'error', 'media']);

/**
 * One score for each boolean or number in the result, nested checks included, plus `passed` for
 * the status. Strings such as the error message become the comment on `passed`.
 */
export function resultScores(result: Record<string, unknown>): Evaluation[] {
  const scores: Evaluation[] = [];
  const error = typeof result.error === 'string' ? result.error : undefined;
  scores.push({
    name: 'passed',
    value: result.status === 'passed' ? 1 : 0,
    dataType: 'BOOLEAN',
    ...(error === undefined ? {} : {comment: error}),
  });
  for (const [key, value] of Object.entries(result)) {
    if (identityFields.has(key)) continue;
    flattenScores({prefix: key, value, scores});
  }
  return scores;
}

function median(values: number[]): number | undefined {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  const upper = sorted[middle] as number;
  return sorted.length % 2 === 1 ? upper : ((sorted[middle - 1] as number) + upper) / 2;
}

/** Pass rate over every repeat, pass^k over cases, and the median cost and duration. */
export function runScores(results: CaseResult[]): Evaluation[] {
  if (results.length === 0) return [];
  const passed = results.filter((result) => result.status === 'passed').length;
  const byCase = new Map<string, CaseResult[]>();
  for (const result of results) {
    byCase.set(result.case, [...(byCase.get(result.case) ?? []), result]);
  }
  const allRepeatsPassed = [...byCase.values()].filter((repeats) =>
    repeats.every((result) => result.status === 'passed'),
  ).length;

  const scores: Evaluation[] = [
    {name: 'pass_rate', value: passed / results.length, dataType: 'NUMERIC'},
    {name: 'pass_rate_over_k', value: allRepeatsPassed / byCase.size, dataType: 'NUMERIC'},
  ];
  const medianCost = median(results.map((result) => result.cost_usd));
  if (medianCost !== undefined) {
    scores.push({name: 'median_cost_usd', value: medianCost, dataType: 'NUMERIC'});
  }
  const medianDuration = median(results.map((result) => result.duration_ms));
  if (medianDuration !== undefined) {
    scores.push({name: 'median_duration_ms', value: medianDuration, dataType: 'NUMERIC'});
  }
  return scores;
}

async function git(args: string[]): Promise<string | undefined> {
  try {
    const {stdout} = await execFileAsync('git', args);
    return stdout.trim() || undefined;
  } catch {
    return undefined;
  }
}

export interface RunIdentity {
  commit: string | undefined;
  branch: string | undefined;
  runName: string;
}

/** The run name is short commit, branch, and UTC date, so runs sort and compare by revision. */
export async function describeRun({
  env = process.env,
  now = new Date(),
}: {
  env?: LangfuseEnvironment;
  now?: Date;
} = {}): Promise<RunIdentity> {
  const commit = env.GITHUB_SHA ?? (await git(['rev-parse', 'HEAD']));
  const branch =
    env.GITHUB_HEAD_REF ||
    env.GITHUB_REF_NAME ||
    (await git(['rev-parse', '--abbrev-ref', 'HEAD']));
  const parts = [commit?.slice(0, 7), branch, now.toISOString().slice(0, 10)].filter(
    (part): part is string => Boolean(part),
  );
  return {commit, branch, runName: parts.join(' ')};
}

export interface LangfuseExportOptions {
  suite: string;
  mode: 'scripted' | 'live';
  run: ResultsRun;
  /** Extra run metadata, such as models, skill revisions, template versions, and runner options. */
  metadata?: Record<string, unknown>;
  env?: LangfuseEnvironment;
  /** Replaces the client and tracing setup, for tests. The caller owns its lifecycle. */
  client?: Pick<LangfuseClient, 'experiment' | 'score'>;
}

export interface LangfuseExport {
  experiment: string;
  runName: string;
  items: number;
  summaryTraceId: string;
}

function recordRunSummary({
  client,
  experiment,
  runName,
  results,
  summary,
}: {
  client: Pick<LangfuseClient, 'score'>;
  experiment: string;
  runName: string;
  results: CaseResult[];
  summary: string;
}): string {
  // A run over local data has no dataset run, so Langfuse drops run-level scores. They go on a
  // summary trace named after the experiment instead.
  return startActiveObservation(`${experiment}/summary`, (span) => {
    span.update({
      input: {experiment, run: runName},
      output: {
        summary: base64DataUri({contentType: 'text/markdown', text: summary}),
      },
    });
    for (const score of runScores(results)) {
      client.score.create({traceId: span.traceId, ...score});
    }
    return span.traceId;
  });
}

/**
 * Sends a finished run to Langfuse as one experiment named `<suite>/<mode>` with one item per
 * case and repeat. Returns undefined when the keys are not set.
 */
export async function exportToLangfuse(
  options: LangfuseExportOptions,
): Promise<LangfuseExport | undefined> {
  const env = options.env ?? process.env;
  if (!options.client && !isLangfuseConfigured(env)) return undefined;

  const experiment = `${options.suite}/${options.mode}`;
  const identity = await describeRun({env});
  const summary = await readFile(join(options.run.directory, 'summary.md'), 'utf8');
  const results = options.run.results;
  const lookup: ResultLookup = new Map(
    results.map((result) => [itemKey({case: result.case, repeat: result.repeat}), result]),
  );

  const provider = options.client
    ? undefined
    : new NodeTracerProvider({spanProcessors: [new LangfuseSpanProcessor()]});
  provider?.register();
  const client = options.client ?? new LangfuseClient();

  try {
    await client.experiment.run({
      name: experiment,
      runName: identity.runName,
      metadata: {
        commit: identity.commit,
        branch: identity.branch,
        eval_run_id: options.run.runId,
        ...options.metadata,
      },
      data: buildExperimentItems(results),
      task: safeTask({results: lookup, summary}),
      evaluators: [async ({output}) => resultScores(output as Record<string, unknown>)],
    });
    const summaryTraceId = recordRunSummary({
      client,
      experiment,
      runName: identity.runName,
      results,
      summary,
    });
    return {experiment, runName: identity.runName, items: results.length, summaryTraceId};
  } finally {
    if (!options.client) {
      await (client as LangfuseClient).shutdown();
      await provider?.shutdown();
    }
  }
}
