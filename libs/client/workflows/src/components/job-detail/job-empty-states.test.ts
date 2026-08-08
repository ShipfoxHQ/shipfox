import {
  workflowJob,
  workflowJobExecutionDto,
  workflowStepDto,
} from '#test/fixtures/workflow-run.js';
import {
  emptyStateForJob,
  emptyStateForMissingExecution,
  jobSucceededSummary,
} from './job-empty-states.js';

describe('jobSucceededSummary', () => {
  test('counts only succeeded steps when skipped steps are present', () => {
    const job = workflowJob({
      status: 'succeeded',
      job_executions: [
        workflowJobExecutionDto({
          status: 'succeeded',
          steps: [
            workflowStepDto({status: 'succeeded'}),
            workflowStepDto({status: 'skipped', position: 1}),
          ],
        }),
      ],
    });
    const execution = job.jobExecutions[0];
    if (!execution) throw new Error('Expected a job execution');

    expect(jobSucceededSummary(job, execution)).toBe('1 step succeeded');
  });
});

describe('materialized output failure empty states', () => {
  const description =
    'A materialized job output could not be persisted: it exceeded a size or entry cap, contained a non-JSON-safe value, or referenced an unresolved value. Check the output mapping and values before re-running the workflow.';

  test('explains an output failure on an execution with no recorded steps', () => {
    const job = workflowJob({
      status: 'failed',
      status_reason: 'output_invalid',
      job_executions: [
        workflowJobExecutionDto({status: 'failed', status_reason: 'output_invalid', steps: []}),
      ],
    });
    const execution = job.jobExecutions[0];
    if (!execution) throw new Error('Expected a job execution');

    expect(emptyStateForJob(job, execution)).toMatchObject({description});
  });

  test('explains an output failure when the job execution is unavailable', () => {
    const job = workflowJob({status: 'failed', status_reason: 'output_invalid'});

    expect(emptyStateForMissingExecution(job)).toMatchObject({description});
  });
});
