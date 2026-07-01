import type {Job} from '#core/entities/job.js';
import {toJobDto} from './job.js';

describe('toJobDto', () => {
  it('maps job status reason to snake_case', () => {
    const job = jobEntity({status: 'skipped', statusReason: 'dependency_not_completed'});

    const dto = toJobDto(job);

    expect(dto.status).toBe('skipped');
    expect(dto.status_reason).toBe('dependency_not_completed');
  });

  it('maps a running duration descriptor', () => {
    const startedAt = new Date('2026-06-21T12:00:30.000Z');
    const job = jobEntity({status: 'running', startedAt});

    const dto = toJobDto(job);

    expect(dto.duration).toEqual({kind: 'running', from_iso: startedAt.toISOString()});
  });

  it('maps a finished duration descriptor', () => {
    const startedAt = new Date('2026-06-21T12:00:30.000Z');
    const finishedAt = new Date('2026-06-21T12:02:44.000Z');
    const job = jobEntity({status: 'succeeded', startedAt, finishedAt});

    const dto = toJobDto(job);

    expect(dto.duration).toEqual({
      kind: 'finished',
      from_iso: startedAt.toISOString(),
      to_iso: finishedAt.toISOString(),
    });
  });

  it('maps a queued job cancelled before start to no duration', () => {
    const queuedAt = new Date('2026-06-21T12:00:00.000Z');
    const finishedAt = new Date('2026-06-21T12:01:00.000Z');
    const job = jobEntity({status: 'cancelled', queuedAt, startedAt: null, finishedAt});

    const dto = toJobDto(job);

    expect(dto.duration).toEqual({kind: 'none'});
  });
});

function jobEntity(overrides: Partial<Job> = {}): Job {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    workflowRunAttemptId: '22222222-2222-4222-8222-222222222222',
    name: 'deploy',
    status: 'pending',
    statusReason: null,
    carriedOver: false,
    dependencies: [],
    runner: null,
    position: 0,
    version: 1,
    createdAt: new Date('2026-06-25T00:00:00.000Z'),
    updatedAt: new Date('2026-06-25T00:00:01.000Z'),
    timedOutAt: null,
    queuedAt: null,
    startedAt: null,
    finishedAt: null,
    ...overrides,
  };
}
