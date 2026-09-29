import {mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import type {ExperimentParams, LangfuseClient} from '@langfuse/client';
import {afterEach, describe, expect, it} from '@shipfox/vitest/vi';
import {
  buildExperimentItems,
  describeRun,
  exportToLangfuse,
  isLangfuseConfigured,
  resultScores,
  runScores,
  safeTask,
} from './langfuse.js';
import type {CaseResult, ResultsRun} from './results.js';

const markdownDataUri = /^data:text\/markdown;base64,/u;
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, {recursive: true})),
  );
});

function result(overrides: Partial<CaseResult> = {}): CaseResult {
  return {
    case: 'ticket-to-pr/feedback-loop',
    mode: 'scripted',
    repeat: 1,
    status: 'passed',
    duration_ms: 1000,
    cost_usd: 0,
    ...overrides,
  };
}

describe('isLangfuseConfigured', () => {
  it('needs both keys', () => {
    expect(isLangfuseConfigured({})).toBe(false);
    expect(isLangfuseConfigured({LANGFUSE_PUBLIC_KEY: 'pk'})).toBe(false);
    expect(isLangfuseConfigured({LANGFUSE_SECRET_KEY: 'sk'})).toBe(false);
    expect(isLangfuseConfigured({LANGFUSE_PUBLIC_KEY: 'pk', LANGFUSE_SECRET_KEY: 'sk'})).toBe(true);
  });
});

describe('resultScores', () => {
  it('scores every boolean and number, including nested checks', () => {
    const scores = resultScores({
      ...result({duration_ms: 42, cost_usd: 0.5}),
      checks: {writes: true, outputs: false},
      ignored: 'text',
    });

    expect(scores).toEqual([
      {name: 'passed', value: 1, dataType: 'BOOLEAN'},
      {name: 'duration_ms', value: 42, dataType: 'NUMERIC'},
      {name: 'cost_usd', value: 0.5, dataType: 'NUMERIC'},
      {name: 'checks.writes', value: 1, dataType: 'BOOLEAN'},
      {name: 'checks.outputs', value: 0, dataType: 'BOOLEAN'},
    ]);
  });

  it('carries the error as the comment on a failed score', () => {
    const [passed] = resultScores({...result({status: 'error', error: 'timed out'})});

    expect(passed).toEqual({name: 'passed', value: 0, dataType: 'BOOLEAN', comment: 'timed out'});
  });
});

describe('runScores', () => {
  it('reports pass rate, pass rate over k, and medians', () => {
    const scores = runScores([
      result({case: 'a', repeat: 1, duration_ms: 10, cost_usd: 1}),
      result({case: 'a', repeat: 2, duration_ms: 30, cost_usd: 3}),
      result({case: 'b', repeat: 1, status: 'error', duration_ms: 20, cost_usd: 2}),
      result({case: 'b', repeat: 2, duration_ms: 40, cost_usd: 4}),
    ]);

    expect(Object.fromEntries(scores.map((score) => [score.name, score.value]))).toEqual({
      pass_rate: 0.75,
      pass_rate_over_k: 0.5,
      median_cost_usd: 2.5,
      median_duration_ms: 25,
    });
  });
});

describe('experiment items', () => {
  it('keeps the input to the case and repeat so runs compare item by item', () => {
    expect(buildExperimentItems([result({duration_ms: 99, cost_usd: 9})])).toEqual([
      {input: {case: 'ticket-to-pr/feedback-loop', repeat: 1}},
    ]);
  });

  it('never throws, so no item is dropped', async () => {
    const task = safeTask({results: new Map(), summary: '# Summary'});

    const output = await task({input: {case: 'missing', repeat: 2}});

    expect(output).toMatchObject({case: 'missing', repeat: 2, status: 'error'});
  });

  it('attaches the composed YAML and the summary as base64 data URIs', async () => {
    const recorded = result({composed_yaml: 'name: demo\n'});
    const task = safeTask({
      results: new Map([['ticket-to-pr/feedback-loop#1', recorded]]),
      summary: '# Summary',
    });

    const output = (await task({input: {case: recorded.case, repeat: 1}})) as {
      media: Record<string, string>;
      composed_yaml?: string;
    };

    expect(output.composed_yaml).toBeUndefined();
    expect(output.media.composed_yaml).toBe(
      `data:application/x-yaml;base64,${Buffer.from('name: demo\n').toString('base64')}`,
    );
    expect(output.media.summary).toMatch(markdownDataUri);
  });
});

describe('describeRun', () => {
  it('names the run from the short commit, branch, and UTC date', async () => {
    const identity = await describeRun({
      env: {GITHUB_SHA: 'abcdef1234567', GITHUB_HEAD_REF: 'feature/x'},
      now: new Date('2026-09-29T23:00:00Z'),
    });

    expect(identity.runName).toBe('abcdef1 feature/x 2026-09-29');
  });
});

describe('exportToLangfuse', () => {
  async function fixtureRun(): Promise<ResultsRun> {
    const directory = await mkdtemp(join(tmpdir(), 'shipfox-eval-langfuse-'));
    temporaryDirectories.push(directory);
    await writeFile(join(directory, 'summary.md'), '# Eval results\n');
    return {
      runId: 'proof',
      directory,
      results: [result({repeat: 1}), result({repeat: 2, status: 'error', error: 'boom'})],
    };
  }

  it('does nothing without keys', async () => {
    expect(
      await exportToLangfuse({
        suite: 'templates',
        mode: 'scripted',
        run: await fixtureRun(),
        env: {},
      }),
    ).toBeUndefined();
  });

  it('runs one experiment per suite and mode with an item per case and repeat', async () => {
    const experiments: ExperimentParams[] = [];
    const scores: Array<{name: string; traceId?: string}> = [];
    const client = {
      experiment: {
        run: async (config: ExperimentParams) => {
          experiments.push(config);
          for (const item of config.data) {
            const output = await config.task(item);
            await config.evaluators?.[0]?.({input: item.input, output});
          }
        },
      },
      score: {create: (score: {name: string; traceId?: string}) => scores.push(score)},
    } as unknown as Pick<LangfuseClient, 'experiment' | 'score'>;

    const exported = await exportToLangfuse({
      suite: 'templates',
      mode: 'scripted',
      run: await fixtureRun(),
      metadata: {models: ['gpt-6-luna']},
      client,
    });

    expect(exported).toMatchObject({experiment: 'templates/scripted', items: 2});
    expect(experiments).toHaveLength(1);
    expect(experiments[0]?.name).toBe('templates/scripted');
    expect(experiments[0]?.data).toHaveLength(2);
    expect(experiments[0]?.metadata).toMatchObject({eval_run_id: 'proof', models: ['gpt-6-luna']});
    expect(scores.map((score) => score.name)).toEqual([
      'pass_rate',
      'pass_rate_over_k',
      'median_cost_usd',
      'median_duration_ms',
    ]);
  });
});
