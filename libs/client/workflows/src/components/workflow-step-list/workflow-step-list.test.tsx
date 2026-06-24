import type {RunJobDetailDto, RunStepDetailDto, StepAttemptDto} from '@shipfox/api-workflows-dto';
import {Text} from '@shipfox/react-ui';
import {render, screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type {WorkflowJob} from '#core/workflow-run.js';
import {workflowJob, workflowStepAttemptDto, workflowStepDto} from '#test/fixtures/workflow-run.js';
import {WorkflowStepList} from './workflow-step-list.js';

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

  test('renders expanded slot content with the selected step id', async () => {
    const user = userEvent.setup();
    const step = makeStep({name: 'deploy', attempts: [makeAttempt()]});
    render(
      <WorkflowStepList
        job={makeJob({steps: [step]})}
        renderExpandedStep={({stepId}) => <Text size="sm">slot for {stepId}</Text>}
      />,
    );
    const deploy = screen.getByRole('button', {name: '1. deploy, Pending, attempt 1'});

    await user.click(deploy);

    expect(deploy).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText(`slot for ${step.id}`)).toBeInTheDocument();
  });

  test('reports selection changes including collapse', async () => {
    const user = userEvent.setup();
    const onSelectedStepChange = vi.fn();
    const attempt = makeAttempt();
    const step = makeStep({name: 'deploy', attempts: [attempt]});
    render(
      <WorkflowStepList
        job={makeJob({steps: [step]})}
        onSelectedStepChange={onSelectedStepChange}
      />,
    );
    const deploy = screen.getByRole('button', {name: '1. deploy, Pending, attempt 1'});

    await user.click(deploy);
    await user.click(deploy);

    expect(onSelectedStepChange).toHaveBeenNthCalledWith(1, attempt.id);
    expect(onSelectedStepChange).toHaveBeenNthCalledWith(2, undefined);
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

function makeJob(overrides: Partial<RunJobDetailDto> = {}): WorkflowJob {
  return workflowJob(overrides);
}

function makeStep(overrides: Partial<RunStepDetailDto> = {}): RunStepDetailDto {
  return workflowStepDto(overrides);
}

function makeAttempt(overrides: Partial<StepAttemptDto> = {}): StepAttemptDto {
  return workflowStepAttemptDto(overrides);
}
