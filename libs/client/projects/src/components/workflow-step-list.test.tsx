import {
  jobDtoSchema,
  type StepAttemptDto,
  stepAttemptDtoSchema,
  stepDtoSchema,
} from '@shipfox/api-workflows-dto';
import {fireEvent, render, screen, within} from '@testing-library/react';
import {
  WorkflowStepList,
  type WorkflowStepListJob,
  type WorkflowStepListStep,
} from './workflow-step-list.js';

const jobId = '10000000-0000-4000-8000-000000000001';
const installStepName = /install_dependencies/i;
const failedAttemptTitle = 'Attempt 1, Failed, exit 2';
const succeededAttemptTitle = 'Attempt 1, Succeeded, exit 0';
const secondSucceededAttemptTitle = 'Attempt 2, Succeeded, exit 0';
const firstFailedRestartAttemptTitle = 'Attempt 1, Failed, exit 1';
const runningAttemptTitle = 'Attempt 1, Running';

describe('WorkflowStepList', () => {
  test('renders selected job steps as an ordered list', () => {
    render(<WorkflowStepList job={makeJob()} />);

    const list = screen.getByRole('list');
    const rows = within(list).getAllByRole('listitem');
    expect(rows).toHaveLength(4);
    expect(screen.getByText('01')).toBeInTheDocument();
    expect(screen.getByText('Set up job')).toBeInTheDocument();
    expect(screen.getByText('02')).toBeInTheDocument();
    expect(screen.getByText('install_dependencies')).toBeInTheDocument();
  });

  test('renders setup, unnamed, failed, and cancelled/not-run states', () => {
    render(<WorkflowStepList job={makeJob()} />);

    expect(screen.getByText('setup')).toBeInTheDocument();
    expect(screen.getByText('Step 3')).toBeInTheDocument();
    expect(screen.getByTitle(failedAttemptTitle)).toBeInTheDocument();
    expect(screen.getByText('not run')).toBeInTheDocument();
  });

  test('renders pending and running states without attempt history', () => {
    render(
      <WorkflowStepList
        job={makeJob({
          steps: [
            makeStep({position: 0, name: 'wait_for_capacity', status: 'pending', attempts: []}),
            makeStep({
              position: 1,
              name: 'run_tests',
              status: 'running',
              attempts: [makeAttempt({stepPosition: 1, status: 'running', exit_code: null})],
            }),
          ],
        })}
        defaultExpandedStepIds={[stepId(1)]}
      />,
    );

    expect(screen.getByText('not started')).toBeInTheDocument();
    expect(screen.getByText('No attempts have been dispatched for this step.')).toBeInTheDocument();
    expect(screen.getByTitle(runningAttemptTitle)).toBeInTheDocument();
  });

  test('expands and collapses a row with typed step details', () => {
    render(<WorkflowStepList job={makeJob()} />);

    const row = screen.getByRole('button', {name: installStepName});
    expect(row).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(row);

    expect(row).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('pnpm install --frozen-lockfile')).toBeInTheDocument();
    expect(screen.getByText('Attempts')).toBeInTheDocument();

    fireEvent.click(row);

    expect(row).toHaveAttribute('aria-expanded', 'false');
  });

  test('renders failed step errors in the expanded panel', () => {
    render(<WorkflowStepList job={makeJob()} defaultExpandedStepIds={[stepId(3)]} />);

    expect(screen.getByText('Step failed')).toBeInTheDocument();
    expect(screen.getAllByText('command exited with code 2')).toHaveLength(2);
    expect(screen.getByText('exit 2')).toBeInTheDocument();
  });

  test('renders setup fallback copy when no command is present', () => {
    render(
      <WorkflowStepList
        job={makeJob({
          steps: [
            makeStep({
              position: 0,
              name: 'Set up job',
              type: 'setup',
              status: 'succeeded',
              config: {},
              attempts: [makeAttempt({stepPosition: 0, status: 'succeeded', exit_code: 0})],
            }),
          ],
        })}
        defaultExpandedStepIds={[stepId(1)]}
      />,
    );

    expect(screen.getByText('Prepare job workspace')).toBeInTheDocument();
  });

  test('renders multiple attempts and typed restart badges without parsing gate_result', () => {
    render(<WorkflowStepList job={makeRestartedJob()} defaultExpandedStepIds={[stepId(2)]} />);

    expect(screen.getByTitle(succeededAttemptTitle)).toBeInTheDocument();
    expect(screen.getAllByTitle(secondSucceededAttemptTitle)).toHaveLength(2);
    expect(screen.getByTitle(firstFailedRestartAttemptTitle)).toBeInTheDocument();
    expect(screen.getByText('restart')).toBeInTheDocument();
    expect(screen.getByText('restart queued')).toBeInTheDocument();
  });

  test('reports selected step changes from row expansion', () => {
    const onSelectedStepChange = vi.fn();
    render(
      <WorkflowStepList
        job={makeJob()}
        selectedStepId={stepId(2)}
        onSelectedStepChange={onSelectedStepChange}
      />,
    );

    const row = screen.getByRole('button', {name: installStepName});

    expect(row).toHaveAttribute('aria-current', 'true');

    fireEvent.click(row);
    fireEvent.click(row);

    expect(onSelectedStepChange).toHaveBeenCalledTimes(1);
    expect(onSelectedStepChange).toHaveBeenCalledWith(stepId(2));
  });
});

function makeJob({steps}: {steps?: WorkflowStepListStep[]} = {}): WorkflowStepListJob {
  return {
    ...jobDtoSchema.parse({
      id: jobId,
      run_id: '20000000-0000-4000-8000-000000000001',
      name: 'validate_release',
      status: 'failed',
      dependencies: ['remediate_checkout'],
      position: 1,
      created_at: '2026-06-16T10:00:00.000Z',
      updated_at: '2026-06-16T10:06:00.000Z',
    }),
    steps: steps ?? [
      makeStep({
        position: 0,
        name: 'Set up job',
        type: 'setup',
        status: 'succeeded',
        attempts: [makeAttempt({stepPosition: 0, status: 'succeeded', exit_code: 0})],
      }),
      makeStep({
        position: 1,
        name: 'install_dependencies',
        status: 'succeeded',
        config: {run: 'pnpm install --frozen-lockfile'},
        attempts: [makeAttempt({stepPosition: 1, status: 'succeeded', exit_code: 0})],
      }),
      makeStep({
        position: 2,
        name: null,
        status: 'failed',
        config: {run: 'pnpm test'},
        error: {message: 'command exited with code 2', exit_code: 2, category: 'user'},
        attempts: [
          makeAttempt({
            stepPosition: 2,
            status: 'failed',
            exit_code: 2,
            error: {message: 'command exited with code 2', exitCode: 2},
          }),
        ],
      }),
      makeStep({position: 3, name: 'deploy', status: 'cancelled', attempts: []}),
    ],
  };
}

function makeRestartedJob(): WorkflowStepListJob {
  return makeJob({
    steps: [
      makeStep({
        position: 0,
        name: 'collect_canary_metrics',
        status: 'succeeded',
        attempts: [
          makeAttempt({stepPosition: 0, attempt: 1, status: 'succeeded', exit_code: 0}),
          makeAttempt({stepPosition: 0, attempt: 2, status: 'succeeded', exit_code: 0}),
        ],
      }),
      makeStep({
        position: 1,
        name: 'compare_error_budget',
        status: 'succeeded',
        attempts: [
          makeAttempt({
            stepPosition: 1,
            attempt: 1,
            status: 'failed',
            exit_code: 1,
            gate_result: {kind: 'failed', passed: false, source: 'exit_code == 0', exit_code: 1},
            restart_reason: 'gate-failed',
            error: {message: 'gate failed'},
          }),
          makeAttempt({stepPosition: 1, attempt: 2, status: 'succeeded', exit_code: 0}),
        ],
      }),
    ],
  });
}

function makeStep({
  position,
  name,
  status,
  type = 'run',
  config = {run: `echo step-${position}`},
  error = null,
  attempts = [],
}: {
  position: number;
  name: string | null;
  status: string;
  type?: string;
  config?: Record<string, unknown>;
  error?: WorkflowStepListStep['error'];
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
      error,
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
  attempt = 1,
  status,
  exit_code,
  error = null,
  gate_result = null,
  restart_reason = null,
}: {
  stepPosition: number;
  attempt?: number;
  status: string;
  exit_code: number | null;
  error?: Record<string, unknown> | null;
  gate_result?: Record<string, unknown> | null;
  restart_reason?: string | null;
}): StepAttemptDto {
  return stepAttemptDtoSchema.parse({
    id: attemptId(stepPosition, attempt),
    step_id: stepId(stepPosition + 1),
    job_id: jobId,
    attempt,
    status,
    exit_code,
    output: null,
    error,
    gate_result,
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
