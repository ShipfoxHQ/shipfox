import type {Job} from '#core/entities/job.js';
import {toJobDto} from './job.js';

describe('toJobDto', () => {
  it('maps job status reason to snake_case', () => {
    const job = jobEntity({status: 'skipped', statusReason: 'dependency_not_completed'});

    const dto = toJobDto(job);

    expect(dto.status).toBe('skipped');
    expect(dto.status_reason).toBe('dependency_not_completed');
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
