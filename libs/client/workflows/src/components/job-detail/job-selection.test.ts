import {buildStepListModel} from '#components/step-list/step-list-model.js';
import type {Job} from '#core/workflow-run.js';
import {
  workflowJob,
  workflowJobExecutionDto,
  workflowStepAttemptDto,
  workflowStepDto,
} from '#test/fixtures/workflow-run.js';
import {resolveWorkflowJobSelection, workflowJobLandingSelection} from './job-selection.js';

describe('resolveWorkflowJobSelection', () => {
  test('resolves a deep-linked step and exact attempt within the job', () => {
    const step = workflowStepDto({
      id: 'step-build',
      attempts: [
        workflowStepAttemptDto({id: 'attempt-1', step_id: 'step-build', attempt: 1}),
        workflowStepAttemptDto({id: 'attempt-2', step_id: 'step-build', attempt: 2}),
      ],
    });
    const job = workflowJob({id: 'job-build', steps: [step]});

    const resolved = resolveWorkflowJobSelection({
      job,
      selection: {
        stepId: 'step-build',
        stepAttemptId: 'attempt-2',
        jobExecutionId: 'missing-execution',
      },
    });

    expect(resolved.step?.id).toBe('step-build');
    expect(resolved.attempt?.id).toBe('attempt-2');
    expect(resolved.selectedAttemptId).toBe('attempt-2');
  });

  test('drops a step id belonging to another job and uses the default execution', () => {
    const job = workflowJob({
      id: 'job-build',
      job_executions: [
        workflowJobExecutionDto({id: 'execution-old', job_id: 'job-build', sequence: 1}),
        workflowJobExecutionDto({id: 'execution-build', job_id: 'job-build', sequence: 2}),
      ],
    });

    const resolved = resolveWorkflowJobSelection({
      job,
      selection: {stepId: 'step-other', jobExecutionId: 'execution-old'},
    });

    expect(resolved.step).toBeUndefined();
    expect(resolved.jobExecution?.id).toBe('execution-build');
  });

  test('a step wins over a valid execution id from another execution', () => {
    const step = workflowStepDto({id: 'step-build', job_execution_id: 'execution-two'});
    const job = workflowJob({
      id: 'job-build',
      job_executions: [
        workflowJobExecutionDto({id: 'execution-one', job_id: 'job-build', sequence: 1}),
        workflowJobExecutionDto({
          id: 'execution-two',
          job_id: 'job-build',
          sequence: 2,
          steps: [step],
        }),
      ],
    });

    const resolved = resolveWorkflowJobSelection({
      job,
      selection: {stepId: 'step-build', jobExecutionId: 'execution-one'},
    });

    expect(resolved.jobExecution?.id).toBe('execution-two');
  });
});

describe('workflowJobLandingSelection', () => {
  test('selects the running step', () => {
    const job = workflowJob({
      steps: [
        workflowStepDto({
          id: 'step-finished',
          status: 'succeeded',
          attempts: [workflowStepAttemptDto({status: 'succeeded'})],
        }),
        workflowStepDto({
          id: 'step-running',
          position: 1,
          status: 'running',
          attempts: [workflowStepAttemptDto({id: 'attempt-running', status: 'running'})],
        }),
      ],
    });

    expect(landingSelection(job)).toEqual({
      stepId: 'step-running',
      attemptId: 'attempt-running',
    });
  });

  test('selects the running step the job waits on, not a background step started after it', () => {
    const job = workflowJob({
      steps: [
        workflowStepDto({
          id: 'step-test',
          status: 'running',
          attempts: [
            workflowStepAttemptDto({id: 'attempt-test', status: 'running', execution_order: 1}),
          ],
        }),
        workflowStepDto({
          id: 'step-upload',
          position: 1,
          background: true,
          status: 'running',
          attempts: [
            workflowStepAttemptDto({id: 'attempt-upload', status: 'running', execution_order: 2}),
          ],
        }),
      ],
    });

    expect(landingSelection(job)).toEqual({
      stepId: 'step-test',
      attemptId: 'attempt-test',
    });
  });

  test('selects the earliest running step when only background steps run', () => {
    const job = workflowJob({
      steps: ['security', 'perf'].map((key, index) =>
        workflowStepDto({
          id: `step-${key}`,
          position: index,
          background: true,
          status: 'running',
          attempts: [
            workflowStepAttemptDto({
              id: `attempt-${key}`,
              status: 'running',
              execution_order: index + 1,
            }),
          ],
        }),
      ),
    });

    expect(landingSelection(job)).toEqual({
      stepId: 'step-security',
      attemptId: 'attempt-security',
    });
  });

  test('selects the first failed step when no step is running', () => {
    const job = workflowJob({
      steps: [
        workflowStepDto({
          id: 'step-failed-first',
          status: 'failed',
          attempts: [workflowStepAttemptDto({id: 'attempt-failed-first', status: 'failed'})],
        }),
        workflowStepDto({
          id: 'step-failed-second',
          position: 1,
          status: 'failed',
          attempts: [workflowStepAttemptDto({status: 'failed'})],
        }),
      ],
    });

    expect(landingSelection(job)).toEqual({
      stepId: 'step-failed-first',
      attemptId: 'attempt-failed-first',
    });
  });

  test('skips a failed step whose failure leaves the job result unchanged', () => {
    const job = workflowJob({
      steps: [
        workflowStepDto({
          id: 'step-ignored',
          status: 'failed',
          affects_job: false,
          attempts: [workflowStepAttemptDto({status: 'failed', failure_ignored: true})],
        }),
        workflowStepDto({
          id: 'step-failed',
          position: 1,
          status: 'failed',
          affects_job: true,
          attempts: [workflowStepAttemptDto({id: 'attempt-failed', status: 'failed'})],
        }),
      ],
    });

    expect(landingSelection(job)).toEqual({
      stepId: 'step-failed',
      attemptId: 'attempt-failed',
    });
  });

  test('selects the current attempt for the first failed step', () => {
    const job = workflowJob({
      steps: [
        workflowStepDto({
          id: 'step-failed',
          status: 'failed',
          current_attempt: 2,
          attempts: [
            workflowStepAttemptDto({id: 'attempt-old', attempt: 1, status: 'failed'}),
            workflowStepAttemptDto({id: 'attempt-current', attempt: 2, status: 'failed'}),
          ],
        }),
      ],
    });

    expect(landingSelection(job)).toEqual({
      stepId: 'step-failed',
      attemptId: 'attempt-current',
    });
  });

  test('selects the inner step that failed a composite', () => {
    const job = workflowJob({
      steps: [
        workflowStepDto({
          id: 'step-setup',
          type: 'composite',
          position: 1,
          status: 'failed',
          attempts: [workflowStepAttemptDto({id: 'attempt-setup', status: 'failed'})],
        }),
        workflowStepDto({
          id: 'step-install',
          parent_step_id: 'step-setup',
          position: 2,
          status: 'failed',
          attempts: [workflowStepAttemptDto({id: 'attempt-install', status: 'failed'})],
        }),
      ],
    });

    expect(landingSelection(job)).toEqual({
      stepId: 'step-install',
      attemptId: 'attempt-install',
    });
  });

  test('selects nothing when every step succeeded', () => {
    const job = workflowJob({
      steps: [
        workflowStepDto({
          status: 'succeeded',
          attempts: [workflowStepAttemptDto({status: 'succeeded'})],
        }),
      ],
    });

    expect(landingSelection(job)).toBeUndefined();
  });
});

function landingSelection(job: Job) {
  const jobExecution = job.jobExecutions[0];
  return workflowJobLandingSelection({
    jobExecution,
    stepListModel: buildStepListModel({job, jobExecution}),
  });
}
