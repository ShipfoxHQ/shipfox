import type {RunUsageResponseDto} from '@shipfox/api-usage-dto';
import type {WorkflowRunObservation} from '@shipfox/e2e-observe-workflows';
import {describe, expect, it} from '@shipfox/vitest/vi';
import {collectMeasures, countGateRetries, tokenMeasures} from './measures.js';

function segment(tokens: {input: number; output: number; cached?: number; reasoning?: number}) {
  return {
    request_count: 1,
    input_tokens: tokens.input,
    output_tokens: tokens.output,
    cache_read_tokens: tokens.cached ?? 0,
    reasoning_tokens: tokens.reasoning ?? 0,
  };
}

function usageOf(segments: Array<ReturnType<typeof segment>>): RunUsageResponseDto {
  return {job_executions: [], inference_segments: segments} as unknown as RunUsageResponseDto;
}

function observationOf(attemptsPerStep: number[][]): WorkflowRunObservation {
  return {
    jobs: [
      {
        executions: attemptsPerStep.map((attempts) => ({
          steps: attempts.map((count) => ({attempts: Array.from({length: count})})),
        })),
      },
    ],
  } as unknown as WorkflowRunObservation;
}

describe('token measures', () => {
  it('sums every inference segment of the run', () => {
    const totals = tokenMeasures(
      usageOf([
        segment({input: 100, output: 20, cached: 40}),
        segment({input: 50, output: 10, reasoning: 5}),
      ]),
    );

    expect(totals).toEqual({
      input_tokens: 150,
      output_tokens: 30,
      cache_read_tokens: 40,
      reasoning_tokens: 5,
      model_requests: 2,
    });
  });

  it('reports zero tokens for a run that called no model', () => {
    expect(tokenMeasures(usageOf([])).input_tokens).toBe(0);
  });
});

describe('gate retries', () => {
  it('counts the step attempts after each step first one', () => {
    expect(countGateRetries(observationOf([[1, 3, 2], [1]]))).toBe(3);
  });

  it('counts none when every step ran once', () => {
    expect(countGateRetries(observationOf([[1, 1]]))).toBe(0);
  });
});

describe('collecting measures', () => {
  it('reads the usage of the run from the workspace usage route', async () => {
    const requests: string[] = [];
    const client = {
      requestJson: <T>(_method: 'get', path: string) => {
        requests.push(path);
        return Promise.resolve(usageOf([segment({input: 7, output: 3})]) as T);
      },
    };

    const measures = await collectMeasures({
      client,
      workspaceId: 'workspace-1',
      runId: 'run-1',
      observation: observationOf([[2]]),
    });

    expect(requests).toEqual(['/usage/workspaces/workspace-1/runs/run-1']);
    expect(measures).toMatchObject({input_tokens: 7, output_tokens: 3, gate_retries: 1});
  });
});
