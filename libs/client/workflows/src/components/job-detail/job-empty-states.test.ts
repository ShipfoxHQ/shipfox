import type {Job, Step} from '#core/workflow-run.js';
import {
  workflowJob,
  workflowJobExecutionDto,
  workflowStepDto,
} from '#test/fixtures/workflow-run.js';
import {
  emptyStateForJob,
  emptyStateForMissingExecution,
  jobSucceededSummary,
  outputFailureDescriptionForExecution,
  skippedJobDescription,
  toSelectedAttemptError,
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

describe('toSelectedAttemptError', () => {
  test('preserves managed-provider metadata from a historical attempt', () => {
    const error = toSelectedAttemptError({type: 'agent'} as Step, {
      message: 'This instance only supports provider `shipfox`.',
      code: 'workspace-providers-disabled',
      managedProviderId: 'shipfox',
      reason: 'agent_config_invalid',
      agentConfigIssue: 'provider_unsupported',
    });

    expect(error).toMatchObject({
      code: 'workspace-providers-disabled',
      managedProviderId: 'shipfox',
      reason: 'agent_config_invalid',
      agentConfigIssue: 'provider_unsupported',
    });
  });

  test('maps legacy gate kind and restart diagnostics from a historical attempt', () => {
    const error = toSelectedAttemptError({type: 'run'} as Step, {
      kind: 'restart_exhausted',
      message: 'The gate did not pass after 1 attempt.',
      source: 'step.exit_code == 0',
      attemptCount: 1,
      maxAttempts: 1,
      restartFrom: 'implement',
    });

    expect(error).toMatchObject({
      reason: 'restart_exhausted',
      source: 'step.exit_code == 0',
      attemptCount: 1,
      maxAttempts: 1,
      restartFrom: 'implement',
    });
  });

  test.each([
    'setup',
    'checkout',
    'agent',
    'run',
  ] as const)('derives the error category for %s steps', (type) => {
    for (const reason of [
      'checkout_auth_failed',
      'checkout_unavailable',
      'checkout_failed',
      'checkout_path_invalid',
      'checkout_destination_occupied',
      'git_unavailable',
      'workspace_prep_failed',
      'setup_aborted',
    ] as const) {
      const error = toSelectedAttemptError({type} as Step, {
        message: 'Checkout failed',
        reason,
      });

      expect(error).toMatchObject({
        reason,
        category: 'setup',
      });
    }
  });

  test.each([
    ['setup', 'setup'],
    ['checkout', 'setup'],
    ['agent', 'user'],
    ['run', 'user'],
  ] as const)('keeps config failures in the expected category for %s steps', (type, category) => {
    const error = toSelectedAttemptError({type} as Step, {
      message: 'Command failed',
      reason: 'config_unresolvable',
    });

    expect(error).toMatchObject({reason: 'config_unresolvable', category});
  });

  test.each([
    'execution_payload_too_large',
    'step_result_too_large',
  ] as const)('preserves bounded failure reason %s', (reason) => {
    const error = toSelectedAttemptError({type: 'run'} as Step, {
      message: 'Bounded workflow value exceeded its limit',
      reason,
    });

    expect(error).toMatchObject({reason, category: 'user'});
  });
});

describe('skippedJobDescription', () => {
  test('explains when materialized output exceeds the configured size limit', () => {
    expect(skippedJobDescription('output_too_large')).toBe('The job output is too large.');
  });
});

describe('runner-loss failure descriptions', () => {
  test.each([
    {
      reason: 'run_cancelled',
      description:
        'The run is cancelled, so this job did not start. Start a new run if you still need the result.',
    },
    {
      reason: 'timed_out',
      description:
        'The job reached its timeout before it started. Rerun the job. If it fails again, contact your workspace admin.',
    },
    {
      reason: 'lease_expired',
      description:
        'The runner stopped responding before the job started. Rerun the job. If it fails again, contact your workspace admin.',
    },
    {
      reason: 'provider_lost',
      description:
        'The runner stopped responding before the job started. Rerun the job. If it fails again, contact your workspace admin.',
    },
    {
      reason: 'lifecycle_violation',
      description:
        'The runner stopped responding before the job started. Rerun the job. If it fails again, contact your workspace admin.',
    },
    {
      reason: 'runner_lost',
      description:
        'The runner stopped responding before the job started. Rerun the job. If it fails again, contact your workspace admin.',
    },
  ] satisfies Array<{
    reason: NonNullable<Job['statusReason']>;
    description: string;
  }>)('distinguishes $reason before the first step', ({reason, description}) => {
    const job = workflowJob({
      status: 'failed',
      status_reason: reason,
      runner: ['runner-linux-x64'],
      job_executions: [
        workflowJobExecutionDto({
          status: 'failed',
          status_reason: reason,
          runner: ['runner-linux-x64'],
          steps: [],
        }),
      ],
    });
    const execution = job.jobExecutions[0];
    if (!execution) throw new Error('Expected a job execution');

    expect(emptyStateForJob(job, execution)).toMatchObject({description});
  });
});

describe('runner_not_allowed failure', () => {
  function deniedJob(message: string | null) {
    const job = workflowJob({
      status: 'failed',
      status_reason: 'runner_not_allowed',
      job_executions: [
        workflowJobExecutionDto({
          status: 'failed',
          status_reason: 'runner_not_allowed',
          status_reason_message: message,
          steps: [],
        }),
      ],
    });
    const execution = job.jobExecutions[0];
    if (!execution) throw new Error('Expected a job execution');
    return {job, execution};
  }

  test('shows the stored notice message with its required action', () => {
    const {job, execution} = deniedJob('This workspace cannot use 16 vCPU runners.');
    execution.statusReasonNotice = {
      reason: 'machine-not-allowed',
      message: 'This workspace cannot use 16 vCPU runners.',
      requiredAction: {
        reason: 'add-credits',
        message: 'Add credits',
        url: '/settings/billing',
        intent: 'contact-support',
      },
    };

    expect(emptyStateForJob(job, execution)).toMatchObject({
      description: 'This workspace cannot use 16 vCPU runners.',
      action: {
        reason: 'add-credits',
        message: 'Add credits',
        url: '/settings/billing',
        intent: 'contact-support',
      },
    });
  });

  test('falls back to generic copy without a stored notice', () => {
    const {job, execution} = deniedJob(null);

    const emptyState = emptyStateForJob(job, execution);

    expect(emptyState?.description).toContain('cannot use the requested runner');
    expect(emptyState?.action).toBeUndefined();
  });
});

describe('materialized output failure descriptions', () => {
  const fallback =
    'Shipfox cannot save a job output. The output is too large, is not valid JSON, or uses a missing value. Fix the job outputs, then start a new run.';

  test('uses the server-authored message for an execution with recorded steps', () => {
    const job = workflowJob({
      status: 'failed',
      status_reason: 'output_invalid',
      job_executions: [
        workflowJobExecutionDto({
          status: 'failed',
          status_reason: 'output_invalid',
          status_reason_message: 'Job output "payload" cannot be persisted as JSON: undefined.',
          steps: [workflowStepDto({status: 'succeeded'})],
        }),
      ],
    });
    const execution = job.jobExecutions[0];
    if (!execution) throw new Error('Expected a job execution');

    expect(outputFailureDescriptionForExecution(execution)).toBe(
      'Job output "payload" cannot be persisted as JSON: undefined.',
    );
  });

  test('keeps the generic fallback for old output-invalid rows without a message', () => {
    const job = workflowJob({
      status: 'failed',
      status_reason: 'output_invalid',
      job_executions: [
        workflowJobExecutionDto({
          status: 'failed',
          status_reason: 'output_invalid',
          steps: [workflowStepDto({status: 'succeeded'})],
        }),
      ],
    });
    const execution = job.jobExecutions[0];
    if (!execution) throw new Error('Expected a job execution');

    expect(outputFailureDescriptionForExecution(execution)).toBe(fallback);
  });

  test('uses the message in the empty state when output materialization failed before steps', () => {
    const job = workflowJob({
      status: 'failed',
      status_reason: 'output_invalid',
      job_executions: [
        workflowJobExecutionDto({
          status: 'failed',
          status_reason: 'output_invalid',
          status_reason_message: 'Job outputs cannot define more than 10 entries (found 11)',
          steps: [],
        }),
      ],
    });
    const execution = job.jobExecutions[0];
    if (!execution) throw new Error('Expected a job execution');

    expect(emptyStateForJob(job, execution)).toMatchObject({
      description: 'Job outputs cannot define more than 10 entries (found 11)',
    });
  });

  test('keeps output failures scoped to the selected execution', () => {
    const job = workflowJob({
      status: 'failed',
      status_reason: 'output_invalid',
      job_executions: [
        workflowJobExecutionDto({
          status: 'succeeded',
          status_reason: null,
          steps: [workflowStepDto({status: 'succeeded'})],
        }),
      ],
    });
    const execution = job.jobExecutions[0];
    if (!execution) throw new Error('Expected a job execution');

    expect(outputFailureDescriptionForExecution(execution)).toBeUndefined();
    expect(
      emptyStateForMissingExecution(
        workflowJob({status: 'failed', status_reason: 'output_invalid'}),
      ),
    ).toMatchObject({
      description: fallback,
    });
  });

  test('explains an oversized listener filter snapshot without an execution', () => {
    expect(
      emptyStateForMissingExecution(
        workflowJob({mode: 'listening', status: 'failed', status_reason: 'output_too_large'}),
      ),
    ).toMatchObject({
      title: 'The job failed before it started',
      description:
        'The data for the listener filter is too large. Make the filter or the outputs of needed jobs smaller. Then start a new run.',
    });
  });

  test('keeps one-shot output-size failures on the materialized-output copy', () => {
    expect(
      emptyStateForMissingExecution(
        workflowJob({status: 'failed', status_reason: 'output_too_large'}),
      ),
    ).toMatchObject({
      description:
        'The job output is too large. Make the outputs smaller, or write large data to a file. Then start a new run.',
    });
  });
});
