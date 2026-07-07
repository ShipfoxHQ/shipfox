import type {Annotation} from '#core/entities/annotation.js';
import {toAnnotationDto} from './annotation.js';

describe('toAnnotationDto', () => {
  it('maps an annotation domain entity to the public DTO shape', () => {
    const annotation: Annotation = {
      id: '11111111-1111-4111-8111-111111111111',
      workspaceId: '22222222-2222-4222-8222-222222222222',
      projectId: '33333333-3333-4333-8333-333333333333',
      workflowRunId: '44444444-4444-4444-8444-444444444444',
      workflowRunAttempt: 2,
      workflowRunAttemptId: '55555555-5555-4555-8555-555555555555',
      jobId: '66666666-6666-4666-8666-666666666666',
      jobExecutionId: '77777777-7777-4777-8777-777777777777',
      originStepId: '88888888-8888-4888-8888-888888888888',
      originStepAttempt: 3,
      context: 'deploy',
      style: 'success',
      sequence: 4,
      body: 'Deployed **v42**',
      bodyBytes: 16,
      createdAt: new Date('2026-07-07T10:00:00.000Z'),
      updatedAt: new Date('2026-07-07T10:01:00.000Z'),
    };

    const result = toAnnotationDto(annotation);

    expect(result).toEqual({
      id: '11111111-1111-4111-8111-111111111111',
      job_id: '66666666-6666-4666-8666-666666666666',
      job_execution_id: '77777777-7777-4777-8777-777777777777',
      origin_step_id: '88888888-8888-4888-8888-888888888888',
      origin_step_attempt: 3,
      context: 'deploy',
      style: 'success',
      sequence: 4,
      body: 'Deployed **v42**',
    });
    expect(result).not.toHaveProperty('workspace_id');
    expect(result).not.toHaveProperty('workflow_run_attempt_id');
  });
});
