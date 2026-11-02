import type {LatestWorkflowRun} from '#core/latest-run.js';
import {latestWorkflowRunsQueryOptions} from './latest-runs.js';
import {ACTIVE_POLL_MS} from './workflow-runs.js';

function run(status: LatestWorkflowRun['status']): LatestWorkflowRun {
  return {
    id: crypto.randomUUID(),
    definitionId: crypto.randomUUID(),
    number: 1,
    status,
    createdAt: '2026-11-02T12:00:00.000Z',
  };
}

function refetchIntervalFor(data: LatestWorkflowRun[] | undefined) {
  const {refetchInterval} = latestWorkflowRunsQueryOptions('project', ['definition']);
  if (typeof refetchInterval !== 'function') throw new Error('Expected an interval function');
  return refetchInterval({state: {data}} as never);
}

describe('latestWorkflowRunsQueryOptions polling', () => {
  test.each(['waiting', 'pending', 'running'] as const)('polls while a run is %s', (status) => {
    expect(refetchIntervalFor([run('succeeded'), run(status)])).toBe(ACTIVE_POLL_MS);
  });

  test('stops once every run ended or nothing has loaded', () => {
    expect(refetchIntervalFor([run('succeeded'), run('failed'), run('cancelled')])).toBe(false);
    expect(refetchIntervalFor([])).toBe(false);
    expect(refetchIntervalFor(undefined)).toBe(false);
  });
});
