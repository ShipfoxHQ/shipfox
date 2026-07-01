import {jobDtoSchema} from './job.js';

const baseJob = {
  id: '11111111-1111-4111-8111-111111111111',
  run_attempt_id: '22222222-2222-4222-8222-222222222222',
  name: 'build',
  status: 'pending',
  status_reason: null,
  carried_over: false,
  dependencies: [],
  position: 0,
  created_at: '2026-06-21T12:00:00.000Z',
  updated_at: '2026-06-21T12:01:00.000Z',
  queued_at: null,
  started_at: null,
  finished_at: null,
};

describe('job DTO schema', () => {
  it('accepts a queued duration descriptor', () => {
    const result = jobDtoSchema.parse({
      ...baseJob,
      duration: {kind: 'queued', from_iso: '2026-06-21T12:00:00.000Z'},
    });

    expect(result.duration).toEqual({kind: 'queued', from_iso: '2026-06-21T12:00:00.000Z'});
  });

  it('accepts a running duration descriptor', () => {
    const result = jobDtoSchema.parse({
      ...baseJob,
      duration: {kind: 'running', from_iso: '2026-06-21T12:00:30.000Z'},
    });

    expect(result.duration).toEqual({kind: 'running', from_iso: '2026-06-21T12:00:30.000Z'});
  });

  it('accepts a finished duration descriptor', () => {
    const result = jobDtoSchema.parse({
      ...baseJob,
      duration: {
        kind: 'finished',
        from_iso: '2026-06-21T12:00:30.000Z',
        to_iso: '2026-06-21T12:02:44.000Z',
      },
    });

    expect(result.duration).toEqual({
      kind: 'finished',
      from_iso: '2026-06-21T12:00:30.000Z',
      to_iso: '2026-06-21T12:02:44.000Z',
    });
  });

  it('accepts a no-duration descriptor', () => {
    const result = jobDtoSchema.parse({
      ...baseJob,
      duration: {kind: 'none'},
    });

    expect(result.duration).toEqual({kind: 'none'});
  });

  it('rejects a descriptor that does not match its kind', () => {
    const result = jobDtoSchema.safeParse({
      ...baseJob,
      duration: {kind: 'finished', from_iso: '2026-06-21T12:00:30.000Z'},
    });

    expect(result.success).toBe(false);
  });
});
