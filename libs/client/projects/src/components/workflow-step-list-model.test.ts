import {jobDtoSchema, stepAttemptDtoSchema, stepDtoSchema} from '@shipfox/api-workflows-dto';
import {
  toWorkflowStepListModel,
  type WorkflowStepListJob,
  type WorkflowStepListStep,
} from './workflow-step-list-model.js';

const jobId = '10000000-0000-4000-8000-000000000001';

describe('toWorkflowStepListModel', () => {
  test('maps DTO step and attempt data into ordered UI rows', () => {
    const job = makeJob({
      status: 'awaiting-runner',
      steps: [
        makeStep({
          position: 1,
          name: null,
          status: 'failed',
          attempts: [
            makeAttempt({stepPosition: 1, attempt: 2, status: 'succeeded', exit_code: 0}),
            makeAttempt({
              stepPosition: 1,
              attempt: 1,
              status: 'failed',
              exit_code: 1,
              restart_reason: 'gate-failed',
              error: {message: 'gate failed'},
            }),
          ],
        }),
        makeStep({
          position: 2,
          name: 'wait_for_capacity',
          status: 'pending',
          attempts: [],
        }),
        makeStep({
          position: 0,
          name: 'Set up job',
          status: 'succeeded',
          type: 'setup',
          config: {},
          attempts: [],
        }),
      ],
    });

    const model = toWorkflowStepListModel(job);

    expect(model.statusLabel).toBe('Awaiting runner');
    expect(model.statusTone).toBe('warning');
    expect(model.steps.map((step) => step.label)).toEqual([
      'Set up job',
      'Step 2',
      'wait_for_capacity',
    ]);
    expect(model.steps[0]).toMatchObject({
      positionLabel: '01',
      command: 'Prepare job workspace',
      noAttemptsLabel: 'not run',
    });
    expect(model.steps[2]).toMatchObject({
      positionLabel: '03',
      noAttemptsLabel: 'not started',
    });
    expect(model.steps[1]?.attempts.map((attempt) => attempt.attemptLabel)).toEqual(['#1', '#2']);
    expect(model.steps[1]?.attempts[0]).toMatchObject({
      title: 'Attempt 1, Failed, exit 1',
      restartBadgeLabel: 'restart queued',
      errorMessage: 'gate failed',
    });
  });
});

function makeJob({
  status = 'failed',
  steps,
}: {
  status?: string;
  steps: WorkflowStepListStep[];
}): WorkflowStepListJob {
  return {
    ...jobDtoSchema.parse({
      id: jobId,
      run_id: '20000000-0000-4000-8000-000000000001',
      name: 'validate_release',
      status,
      dependencies: [],
      position: 1,
      created_at: '2026-06-16T10:00:00.000Z',
      updated_at: '2026-06-16T10:06:00.000Z',
    }),
    steps,
  };
}

function makeStep({
  position,
  name,
  status,
  type = 'run',
  config = {run: `echo step-${position}`},
  attempts = [],
}: {
  position: number;
  name: string | null;
  status: string;
  type?: string;
  config?: Record<string, unknown>;
  attempts?: WorkflowStepListStep['attempts'];
}): WorkflowStepListStep {
  return {
    ...stepDtoSchema.parse({
      id: stepId(position + 1),
      job_id: jobId,
      name,
      source_location: null,
      status,
      type,
      config,
      error: null,
      position,
      current_attempt: attempts.at(-1)?.attempt ?? 1,
      created_at: '2026-06-16T10:00:00.000Z',
      updated_at: '2026-06-16T10:02:00.000Z',
    }),
    attempts,
  };
}

function makeAttempt({
  stepPosition,
  attempt,
  status,
  exit_code,
  error = null,
  restart_reason = null,
}: {
  stepPosition: number;
  attempt: number;
  status: string;
  exit_code: number | null;
  error?: Record<string, unknown> | null;
  restart_reason?: string | null;
}) {
  return stepAttemptDtoSchema.parse({
    id: attemptId(stepPosition, attempt),
    step_id: stepId(stepPosition + 1),
    job_id: jobId,
    attempt,
    status,
    exit_code,
    output: null,
    error,
    gate_result: null,
    restart_reason,
    restart_result: null,
    started_at: '2026-06-16T10:00:00.000Z',
    finished_at: status === 'running' ? null : '2026-06-16T10:01:00.000Z',
  });
}

function stepId(position: number): string {
  return `30000000-0000-4000-8000-${String(position).padStart(12, '0')}`;
}

function attemptId(stepPosition: number, attempt: number): string {
  return `40000000-0000-4000-8000-${String(stepPosition * 100 + attempt).padStart(12, '0')}`;
}
