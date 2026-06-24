import type {RunJobDetailDto, RunStepDetailDto, StepAttemptDto} from '@shipfox/api-workflows-dto';
import {Text} from '@shipfox/react-ui';
import {render, screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {WorkflowStepList} from './workflow-step-list.js';

const LOGS_FOR_RE = /^logs for /u;

describe('WorkflowStepList', () => {
  test('renders a labelled flat step list', () => {
    render(
      <WorkflowStepList
        job={makeJob({
          steps: [makeStep({name: 'build', attempts: [makeAttempt({status: 'running'})]})],
        })}
      />,
    );

    expect(screen.getByRole('region', {name: 'Step attempts'})).toBeInTheDocument();
    expect(screen.queryByText('1 step')).not.toBeInTheDocument();
    expect(screen.getByRole('button', {name: '1. build, Running, attempt 1'})).toBeInTheDocument();
    expect(screen.queryByText('Grouped')).not.toBeInTheDocument();
  });

  test('expands and collapses a row without rendering built-in detail content', async () => {
    const user = userEvent.setup();
    render(
      <WorkflowStepList
        job={makeJob({
          steps: [makeStep({name: 'build', attempts: [makeAttempt({status: 'running'})]})],
        })}
      />,
    );
    const build = screen.getByRole('button', {name: '1. build, Running, attempt 1'});

    await user.click(build);

    expect(build).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('Source')).not.toBeInTheDocument();

    await user.click(build);

    expect(build).toHaveAttribute('aria-expanded', 'false');
  });

  test('renders expanded slot content with the selected attempt context', async () => {
    const user = userEvent.setup();
    const attempt = makeAttempt({status: 'running'});
    const step = makeStep({name: 'deploy', status: 'running', attempts: [attempt]});
    render(
      <WorkflowStepList
        job={makeJob({steps: [step]})}
        renderExpandedStep={({stepId, attempt, attemptId, attemptStatus}) => (
          <Text size="sm">
            slot for {stepId} attempt {attempt} id {attemptId} status {attemptStatus}
          </Text>
        )}
      />,
    );
    const deploy = screen.getByRole('button', {name: '1. deploy, Running, attempt 1'});

    await user.click(deploy);

    expect(deploy).toHaveAttribute('aria-expanded', 'true');
    expect(
      screen.getByText(`slot for ${step.id} attempt 1 id ${attempt.id} status running`),
    ).toBeInTheDocument();
  });

  test('reports selection changes including collapse', async () => {
    const user = userEvent.setup();
    const onSelectedAttemptChange = vi.fn();
    const attempt = makeAttempt();
    const step = makeStep({name: 'deploy', attempts: [attempt]});
    render(
      <WorkflowStepList
        job={makeJob({steps: [step]})}
        onSelectedAttemptChange={onSelectedAttemptChange}
      />,
    );
    const deploy = screen.getByRole('button', {name: '1. deploy, Pending, attempt 1'});

    await user.click(deploy);
    await user.click(deploy);

    expect(onSelectedAttemptChange).toHaveBeenNthCalledWith(1, attempt.id);
    expect(onSelectedAttemptChange).toHaveBeenNthCalledWith(2, undefined);
  });

  test('opens a default selected attempt', () => {
    const attempt = makeAttempt();
    const step = makeStep({name: 'deploy', attempts: [attempt]});
    render(
      <WorkflowStepList
        job={makeJob({steps: [step]})}
        defaultSelectedAttemptId={attempt.id}
        renderExpandedStep={({attemptId}) => <Text size="sm">logs for {attemptId}</Text>}
      />,
    );

    expect(screen.getByRole('button', {name: '1. deploy, Pending, attempt 1'})).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    expect(screen.getByText(`logs for ${attempt.id}`)).toBeInTheDocument();
  });

  test('auto-opens the latest running attempt', () => {
    const installAttempt = makeAttempt({status: 'running', execution_order: 2});
    const deployAttempt = makeAttempt({status: 'running', execution_order: 4});
    const finishedAttempt = makeAttempt({status: 'succeeded', execution_order: 5});
    render(
      <WorkflowStepList
        job={makeJob({
          steps: [
            makeStep({
              name: 'install',
              status: 'running',
              attempts: [installAttempt],
            }),
            makeStep({
              name: 'deploy',
              position: 1,
              status: 'running',
              attempts: [deployAttempt],
            }),
            makeStep({
              name: 'notify',
              position: 2,
              status: 'succeeded',
              attempts: [finishedAttempt],
            }),
          ],
        })}
        autoSelectActiveAttempt
        renderExpandedStep={({attemptId}) => <Text size="sm">logs for {attemptId}</Text>}
      />,
    );

    expect(screen.getByRole('button', {name: '1. install, Running, attempt 1'})).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    expect(screen.getByRole('button', {name: '2. deploy, Running, attempt 1'})).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    expect(screen.getByText(`logs for ${deployAttempt.id}`)).toBeInTheDocument();
  });

  test('does not auto-open when no attempt is running', () => {
    render(
      <WorkflowStepList
        job={makeJob({
          steps: [makeStep({name: 'deploy', attempts: [makeAttempt({status: 'succeeded'})]})],
        })}
        autoSelectActiveAttempt
        renderExpandedStep={({attemptId}) => <Text size="sm">logs for {attemptId}</Text>}
      />,
    );

    expect(screen.getByRole('button', {name: '1. deploy, Succeeded, attempt 1'})).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    expect(screen.queryByText(LOGS_FOR_RE)).not.toBeInTheDocument();
  });

  test('preserves manual collapse across same-job polling and resets on job change', async () => {
    const user = userEvent.setup();
    const attempt = makeAttempt({status: 'running'});
    const step = makeStep({name: 'deploy', status: 'running', attempts: [attempt]});
    const job = makeJob({steps: [step]});
    const {rerender} = render(
      <WorkflowStepList
        job={job}
        autoSelectActiveAttempt
        renderExpandedStep={({attemptId}) => <Text size="sm">logs for {attemptId}</Text>}
      />,
    );
    const deploy = screen.getByRole('button', {name: '1. deploy, Running, attempt 1'});
    expect(screen.getByText(`logs for ${attempt.id}`)).toBeInTheDocument();

    await user.click(deploy);
    rerender(
      <WorkflowStepList
        job={{...job, updated_at: '2026-06-21T12:02:00.000Z'}}
        autoSelectActiveAttempt
        renderExpandedStep={({attemptId}) => <Text size="sm">logs for {attemptId}</Text>}
      />,
    );

    expect(screen.queryByText(`logs for ${attempt.id}`)).not.toBeInTheDocument();

    const nextAttempt = makeAttempt({status: 'running'});
    const nextStep = makeStep({name: 'test', status: 'running', attempts: [nextAttempt]});
    rerender(
      <WorkflowStepList
        job={makeJob({
          id: '44444444-4444-4444-8444-000000000002',
          name: 'test',
          steps: [nextStep],
        })}
        autoSelectActiveAttempt
        renderExpandedStep={({attemptId}) => <Text size="sm">logs for {attemptId}</Text>}
      />,
    );

    expect(screen.getByText(`logs for ${nextAttempt.id}`)).toBeInTheDocument();
  });

  test('renders each attempt as its own flat row', () => {
    render(
      <WorkflowStepList
        job={makeJob({
          steps: [
            makeStep({
              name: 'gate',
              status: 'failed',
              error: {message: 'Gate failed', category: 'user', reason: 'agent_invocation_failed'},
              attempts: [
                makeAttempt({attempt: 1, status: 'failed', exit_code: 1}),
                makeAttempt({attempt: 2, status: 'failed', exit_code: 2, restart_reason: 'retry'}),
              ],
            }),
          ],
        })}
      />,
    );

    expect(
      screen.getByRole('button', {
        name: '1. gate, Failed, attempt 1, User',
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', {
        name: '1. gate, Failed, attempt 2, User',
      }),
    ).toBeInTheDocument();
    expect(screen.queryByText('User')).not.toBeInTheDocument();
    expect(screen.getByText('#1')).toBeInTheDocument();
    expect(screen.getByText('#2')).toBeInTheDocument();
    expect(screen.queryByText('2 attempts')).not.toBeInTheDocument();
    expect(screen.queryByText('exit 2')).not.toBeInTheDocument();
    expect(screen.queryByText('Restarted')).not.toBeInTheDocument();
    expect(screen.queryByText('Gate failed')).not.toBeInTheDocument();
  });

  test('omits zero-attempt steps and hides the attempt chip for one-attempt rows', () => {
    render(
      <WorkflowStepList
        job={makeJob({
          steps: [
            makeStep({name: 'queued', position: 1}),
            makeStep({
              name: 'build',
              position: 2,
              status: 'succeeded',
              attempts: [makeAttempt({attempt: 1, status: 'succeeded'})],
            }),
          ],
        })}
      />,
    );

    expect(screen.queryByRole('button', {name: '1. queued, Pending'})).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', {name: '2. build, Succeeded, attempt 1'}),
    ).toBeInTheDocument();
    expect(screen.queryByText('#1')).not.toBeInTheDocument();
    expect(screen.queryByText('1 attempt')).not.toBeInTheDocument();
  });

  test('renders an empty state', () => {
    render(<WorkflowStepList job={makeJob({steps: []})} />);

    expect(screen.getByText('No step attempts yet')).toBeInTheDocument();
  });

  test('keeps long labels accessible', () => {
    const name = 'release-production-multi-region-with-canary-and-smoke-tests';
    render(
      <WorkflowStepList job={makeJob({steps: [makeStep({name, attempts: [makeAttempt()]})]})} />,
    );

    expect(
      screen.getByRole('button', {name: `1. ${name}, Pending, attempt 1`}),
    ).toBeInTheDocument();
  });
});

function makeJob(overrides: Partial<RunJobDetailDto> = {}): RunJobDetailDto {
  return {
    id: '44444444-4444-4444-8444-000000000001',
    run_id: '11111111-1111-4111-8111-111111111111',
    name: 'build',
    status: 'pending',
    dependencies: [],
    position: 0,
    created_at: '2026-06-21T12:00:00.000Z',
    updated_at: '2026-06-21T12:01:00.000Z',
    queued_at: null,
    started_at: null,
    finished_at: null,
    steps: [],
    ...overrides,
  };
}

let stepSequence = 0;
function makeStep(overrides: Partial<RunStepDetailDto> = {}): RunStepDetailDto {
  stepSequence += 1;
  const displayName =
    overrides.display_name ??
    (typeof overrides.name === 'string' && overrides.name.trim() ? overrides.name : 'build');
  return {
    id: `55555555-5555-4555-8555-${String(stepSequence).padStart(12, '0')}`,
    job_id: '44444444-4444-4444-8444-000000000001',
    name: 'build',
    display_name: displayName,
    source_location: null,
    status: 'pending',
    type: 'run',
    config: {},
    error: null,
    position: 0,
    current_attempt: 1,
    created_at: '2026-06-21T12:00:00.000Z',
    updated_at: '2026-06-21T12:01:00.000Z',
    attempts: [],
    ...overrides,
  };
}

let attemptSequence = 0;
function makeAttempt(overrides: Partial<StepAttemptDto> = {}): StepAttemptDto {
  attemptSequence += 1;
  return {
    id: `66666666-6666-4666-8666-${String(attemptSequence).padStart(12, '0')}`,
    step_id: '55555555-5555-4555-8555-000000000001',
    job_id: '44444444-4444-4444-8444-000000000001',
    attempt: 1,
    execution_order: attemptSequence,
    status: 'pending',
    exit_code: null,
    output: null,
    error: null,
    gate_result: null,
    restart_reason: null,
    restart_result: null,
    started_at: '2026-06-21T12:00:00.000Z',
    finished_at: null,
    ...overrides,
  };
}
