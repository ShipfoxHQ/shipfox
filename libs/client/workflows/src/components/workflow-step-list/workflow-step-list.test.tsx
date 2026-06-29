import type {RunJobDetailDto, RunStepDetailDto, StepAttemptDto} from '@shipfox/api-workflows-dto';
import {Text} from '@shipfox/react-ui';
import {render, screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {useState} from 'react';
import type {WorkflowJob} from '#core/workflow-run.js';
import {workflowJob, workflowStepAttemptDto, workflowStepDto} from '#test/fixtures/workflow-run.js';
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

    expect(screen.getByRole('region', {name: 'build'})).toBeInTheDocument();
    expect(screen.queryByText('1 step')).not.toBeInTheDocument();
    expect(screen.getByRole('button', {name: 'build, Running, attempt 1'})).toBeInTheDocument();
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
    const build = screen.getByRole('button', {name: 'build, Running, attempt 1'});

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
    const deploy = screen.getByRole('button', {name: 'deploy, Running, attempt 1'});

    await user.click(deploy);

    expect(deploy).toHaveAttribute('aria-expanded', 'true');
    expect(
      screen.getByText(`slot for ${step.id} attempt 1 id ${attempt.id} status running`),
    ).toBeInTheDocument();
  });

  test('keeps multiple expanded rows open', async () => {
    const user = userEvent.setup();
    const buildAttempt = makeAttempt({status: 'succeeded'});
    const deployAttempt = makeAttempt({status: 'running'});
    const build = makeStep({name: 'build', attempts: [buildAttempt]});
    const deploy = makeStep({name: 'deploy', position: 1, attempts: [deployAttempt]});
    render(
      <WorkflowStepList
        job={makeJob({steps: [build, deploy]})}
        renderExpandedStep={({attemptId}) => <Text size="sm">logs for {attemptId}</Text>}
      />,
    );
    const buildRow = screen.getByRole('button', {name: 'build, Succeeded, attempt 1'});
    const deployRow = screen.getByRole('button', {name: 'deploy, Running, attempt 1'});

    await user.click(buildRow);
    await user.click(deployRow);

    expect(buildRow).toHaveAttribute('aria-expanded', 'true');
    expect(deployRow).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText(`logs for ${buildAttempt.id}`)).toBeInTheDocument();
    expect(screen.getByText(`logs for ${deployAttempt.id}`)).toBeInTheDocument();
  });

  test('keeps multiple expanded rows open when external attempt selection is singular', async () => {
    const user = userEvent.setup();
    const buildAttempt = makeAttempt({status: 'succeeded'});
    const deployAttempt = makeAttempt({status: 'running'});
    const build = makeStep({name: 'build', attempts: [buildAttempt]});
    const deploy = makeStep({name: 'deploy', position: 1, attempts: [deployAttempt]});
    const job = makeJob({steps: [build, deploy]});

    function ControlledStepList() {
      const [selectedAttemptId, setSelectedAttemptId] = useState<string | null>(null);

      return (
        <WorkflowStepList
          job={job}
          selectedAttemptId={selectedAttemptId}
          onSelectedAttemptChange={(attemptId) => setSelectedAttemptId(attemptId ?? null)}
          renderExpandedStep={({attemptId}) => <Text size="sm">logs for {attemptId}</Text>}
        />
      );
    }

    render(<ControlledStepList />);
    const buildRow = screen.getByRole('button', {name: 'build, Succeeded, attempt 1'});
    const deployRow = screen.getByRole('button', {name: 'deploy, Running, attempt 1'});

    await user.click(buildRow);
    await user.click(deployRow);

    expect(buildRow).toHaveAttribute('aria-expanded', 'true');
    expect(deployRow).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText(`logs for ${buildAttempt.id}`)).toBeInTheDocument();
    expect(screen.getByText(`logs for ${deployAttempt.id}`)).toBeInTheDocument();
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
    const deploy = screen.getByRole('button', {name: 'deploy, Pending, attempt 1'});

    await user.click(deploy);
    await user.click(deploy);

    expect(onSelectedAttemptChange).toHaveBeenNthCalledWith(1, attempt.id);
    expect(onSelectedAttemptChange).toHaveBeenNthCalledWith(2, undefined);
  });

  test('keeps row selection singular when no expanded content is rendered', async () => {
    const user = userEvent.setup();
    const buildAttempt = makeAttempt({status: 'succeeded'});
    const deployAttempt = makeAttempt({status: 'running'});
    const build = makeStep({name: 'build', attempts: [buildAttempt]});
    const deploy = makeStep({name: 'deploy', position: 1, attempts: [deployAttempt]});
    render(<WorkflowStepList job={makeJob({steps: [build, deploy]})} />);
    const buildRow = screen.getByRole('button', {name: 'build, Succeeded, attempt 1'});
    const deployRow = screen.getByRole('button', {name: 'deploy, Running, attempt 1'});

    await user.click(buildRow);
    await user.click(deployRow);

    expect(buildRow).not.toHaveClass('bg-background-components-hover');
    expect(deployRow).toHaveClass('bg-background-components-hover');
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

    expect(screen.getByRole('button', {name: 'deploy, Pending, attempt 1'})).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    expect(screen.getByText(`logs for ${attempt.id}`)).toBeInTheDocument();
  });

  test('starts collapsed for a controlled empty selected attempt', async () => {
    const user = userEvent.setup();
    const onSelectedAttemptChange = vi.fn();
    const attempt = makeAttempt();
    const step = makeStep({name: 'deploy', attempts: [attempt]});
    const job = makeJob({steps: [step]});
    const {rerender} = render(
      <WorkflowStepList
        job={job}
        defaultSelectedAttemptId={attempt.id}
        selectedAttemptId={attempt.id}
        onSelectedAttemptChange={onSelectedAttemptChange}
        renderExpandedStep={({attemptId}) => <Text size="sm">logs for {attemptId}</Text>}
      />,
    );
    const deploy = screen.getByRole('button', {name: 'deploy, Pending, attempt 1'});
    expect(screen.getByText(`logs for ${attempt.id}`)).toBeInTheDocument();

    rerender(
      <WorkflowStepList
        job={job}
        defaultSelectedAttemptId={attempt.id}
        selectedAttemptId={null}
        onSelectedAttemptChange={onSelectedAttemptChange}
        renderExpandedStep={({attemptId}) => <Text size="sm">logs for {attemptId}</Text>}
      />,
    );
    expect(screen.queryByText(`logs for ${attempt.id}`)).not.toBeInTheDocument();

    await user.click(deploy);

    expect(screen.getByText(`logs for ${attempt.id}`)).toBeInTheDocument();
    expect(onSelectedAttemptChange).toHaveBeenCalledWith(attempt.id);
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

    expect(screen.getByRole('button', {name: 'install, Running, attempt 1'})).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    expect(screen.getByRole('button', {name: 'deploy, Running, attempt 1'})).toHaveAttribute(
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

    expect(screen.getByRole('button', {name: 'deploy, Succeeded, attempt 1'})).toHaveAttribute(
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
    const deploy = screen.getByRole('button', {name: 'deploy, Running, attempt 1'});
    expect(screen.getByText(`logs for ${attempt.id}`)).toBeInTheDocument();

    await user.click(deploy);
    rerender(
      <WorkflowStepList
        job={{...job, updatedAt: '2026-06-21T12:02:00.000Z'}}
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
        name: 'gate, Failed, attempt 1, User',
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', {
        name: 'gate, Failed, attempt 2, User',
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

    expect(screen.queryByRole('button', {name: 'queued, Pending'})).not.toBeInTheDocument();
    expect(screen.getByRole('button', {name: 'build, Succeeded, attempt 1'})).toBeInTheDocument();
    expect(screen.queryByText('#1')).not.toBeInTheDocument();
    expect(screen.queryByText('1 attempt')).not.toBeInTheDocument();
  });

  test('renders an empty state', () => {
    render(<WorkflowStepList job={makeJob({steps: []})} />);

    expect(screen.getByText('No steps recorded')).toBeInTheDocument();
    expect(screen.getByText('This job has not recorded any steps.')).toBeInTheDocument();
  });

  test('renders a skipped empty state with a status glyph', () => {
    render(
      <WorkflowStepList
        job={makeJob({status: 'skipped', status_reason: 'dependency_not_completed', steps: []})}
        emptyState={{
          title: 'This job was skipped',
          description: 'A required job did not complete, so this job was skipped.',
          status: 'skipped',
        }}
      />,
    );

    expect(screen.getByText('This job was skipped')).toBeInTheDocument();
    expect(
      screen.getByText('A required job did not complete, so this job was skipped.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('img', {name: 'Skipped'})).toBeInTheDocument();
  });

  test('renders a cancelled empty state with distinct copy', () => {
    render(
      <WorkflowStepList
        job={makeJob({status: 'cancelled', steps: []})}
        emptyState={{
          title: 'Cancelled before start',
          description: 'This job was cancelled before any step started.',
          status: 'cancelled',
        }}
      />,
    );

    expect(screen.getByText('Cancelled before start')).toBeInTheDocument();
    expect(screen.getByText('This job was cancelled before any step started.')).toBeInTheDocument();
    expect(screen.getByRole('img', {name: 'Cancelled'})).toBeInTheDocument();
  });

  test('keeps long labels accessible', () => {
    const name = 'release-production-multi-region-with-canary-and-smoke-tests';
    render(
      <WorkflowStepList job={makeJob({steps: [makeStep({name, attempts: [makeAttempt()]})]})} />,
    );

    expect(screen.getByRole('button', {name: `${name}, Pending, attempt 1`})).toBeInTheDocument();
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
