import type {Job} from './job.js';
import {jobDurationFor} from './job.js';

const QUEUED = new Date('2026-06-21T12:00:00.000Z');
const STARTED = new Date('2026-06-21T12:00:30.000Z');
const FINISHED = new Date('2026-06-21T12:02:44.000Z');

describe('jobDurationFor', () => {
  it('anchors running jobs on startedAt', () => {
    const result = jobDurationFor(job({status: 'running', queuedAt: QUEUED, startedAt: STARTED}));

    expect(result).toEqual({kind: 'running', from: STARTED});
  });

  it('carries the started to finished span for finished jobs', () => {
    const result = jobDurationFor(
      job({status: 'succeeded', startedAt: STARTED, finishedAt: FINISHED}),
    );

    expect(result).toEqual({kind: 'finished', from: STARTED, to: FINISHED});
  });

  it('anchors queued jobs that have not started on queuedAt', () => {
    const result = jobDurationFor(job({status: 'pending', queuedAt: QUEUED, startedAt: null}));

    expect(result).toEqual({kind: 'queued', from: QUEUED});
  });

  it('returns none for skipped jobs that never executed', () => {
    const result = jobDurationFor(job({status: 'skipped', startedAt: null, finishedAt: null}));

    expect(result).toEqual({kind: 'none'});
  });

  it('anchors jobs without startedAt on queuedAt regardless of status', () => {
    const result = jobDurationFor(job({status: 'cancelled', queuedAt: QUEUED, startedAt: null}));

    expect(result).toEqual({kind: 'queued', from: QUEUED});
  });

  it('anchors jobs without finishedAt on startedAt regardless of status', () => {
    const result = jobDurationFor(job({status: 'failed', startedAt: STARTED, finishedAt: null}));

    expect(result).toEqual({kind: 'running', from: STARTED});
  });

  it('returns none before queue or claim events project', () => {
    const result = jobDurationFor(job({status: 'pending', queuedAt: null, startedAt: null}));

    expect(result).toEqual({kind: 'none'});
  });
});

function job(
  overrides: Partial<Job> = {},
): Pick<Job, 'status' | 'queuedAt' | 'startedAt' | 'finishedAt'> {
  return {
    status: 'pending',
    queuedAt: null,
    startedAt: null,
    finishedAt: null,
    ...overrides,
  };
}
