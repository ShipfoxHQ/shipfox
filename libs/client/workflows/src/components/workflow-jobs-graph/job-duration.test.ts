import {workflowJob} from '#test/fixtures/workflow-run.js';
import {jobDurationDisplay} from './job-duration.js';

const QUEUED = '2026-06-21T12:00:00.000Z';
const STARTED = '2026-06-21T12:00:30.000Z';
const FINISHED = '2026-06-21T12:02:44.000Z';

describe('jobDurationDisplay', () => {
  test('running job anchors on startedAt', () => {
    const job = workflowJob({status: 'running', queued_at: QUEUED, started_at: STARTED});

    const result = jobDurationDisplay(job);

    expect(result).toEqual({kind: 'running', fromIso: STARTED});
  });

  test('finished job carries the started→finished span', () => {
    const job = workflowJob({status: 'succeeded', started_at: STARTED, finished_at: FINISHED});

    const result = jobDurationDisplay(job);

    expect(result).toEqual({kind: 'finished', fromIso: STARTED, toIso: FINISHED});
  });

  test('queued job (not yet started) anchors on queuedAt', () => {
    const job = workflowJob({status: 'pending', queued_at: QUEUED, started_at: null});

    const result = jobDurationDisplay(job);

    expect(result).toEqual({kind: 'queued', fromIso: QUEUED});
  });

  test('skipped job never executed → none', () => {
    const job = workflowJob({status: 'skipped', started_at: null, finished_at: null});

    const result = jobDurationDisplay(job);

    expect(result).toEqual({kind: 'none'});
  });

  test('terminal job cancelled before dispatch (no startedAt) → none', () => {
    const job = workflowJob({status: 'cancelled', queued_at: QUEUED, started_at: null});

    const result = jobDurationDisplay(job);

    expect(result).toEqual({kind: 'none'});
  });

  test('terminal job with no finishedAt (crash/lag) → none', () => {
    const job = workflowJob({status: 'failed', started_at: STARTED, finished_at: null});

    const result = jobDurationDisplay(job);

    expect(result).toEqual({kind: 'none'});
  });

  test('non-terminal job before queue/claim events project → none', () => {
    const job = workflowJob({status: 'pending', queued_at: null, started_at: null});

    const result = jobDurationDisplay(job);

    expect(result).toEqual({kind: 'none'});
  });
});
