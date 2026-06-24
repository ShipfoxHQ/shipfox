import type {RunDetailResponseDto, RunJobDetailDto} from '@shipfox/api-workflows-dto';
import {render, screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {WorkflowJobsGraph} from './workflow-jobs-graph.js';

describe('WorkflowJobsGraph', () => {
  test('renders a graph region and trigger', () => {
    render(<WorkflowJobsGraph run={makeRun({jobs: [makeJob({name: 'build'})]})} />);

    expect(screen.getByRole('region', {name: 'Workflow jobs'})).toBeInTheDocument();
    expect(screen.getByRole('button', {name: 'manual / fire'})).toBeInTheDocument();
    expect(screen.getByRole('button', {name: 'build, Pending'})).toBeInTheDocument();
  });

  test('selects and unselects a job locally', async () => {
    const user = userEvent.setup();
    render(<WorkflowJobsGraph run={makeRun({jobs: [makeJob({name: 'build'})]})} />);
    const build = screen.getByRole('button', {name: 'build, Pending'});

    await user.click(build);

    expect(build).toHaveAttribute('aria-pressed', 'true');

    await user.click(build);

    expect(build).toHaveAttribute('aria-pressed', 'false');
  });

  test('supports an initially selected job', () => {
    const buildJob = makeJob({name: 'build'});
    render(
      <WorkflowJobsGraph run={makeRun({jobs: [buildJob]})} defaultSelectedJobId={buildJob.id} />,
    );

    expect(screen.getByRole('button', {name: 'build, Pending'})).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  test('renders two running jobs at the same time', () => {
    render(
      <WorkflowJobsGraph
        run={makeRun({
          jobs: [
            makeJob({name: 'linux', status: 'running'}),
            makeJob({name: 'macos', status: 'running', position: 1}),
          ],
        })}
      />,
    );

    expect(screen.getByRole('button', {name: 'linux, Running'})).toBeInTheDocument();
    expect(screen.getByRole('button', {name: 'macos, Running'})).toBeInTheDocument();
  });

  test('renders a downstream job cancelled after an upstream failure', () => {
    render(
      <WorkflowJobsGraph
        run={makeRun({
          jobs: [
            makeJob({name: 'build', status: 'failed'}),
            makeJob({
              name: 'deploy',
              status: 'cancelled',
              position: 1,
              dependencies: ['build'],
            }),
          ],
        })}
      />,
    );

    expect(screen.getByRole('button', {name: 'build, Failed'})).toBeInTheDocument();
    expect(
      screen.getByRole('button', {name: 'deploy, Cancelled, Depends on build'}),
    ).toBeInTheDocument();
  });

  test('renders an empty state', () => {
    render(<WorkflowJobsGraph run={makeRun({jobs: []})} />);

    expect(screen.getByText('No jobs yet')).toBeInTheDocument();
  });

  test('keeps long names accessible while truncating visually', () => {
    const name = 'release-production-multi-region-with-canary-and-smoke-tests';
    render(<WorkflowJobsGraph run={makeRun({jobs: [makeJob({name})]})} />);

    expect(screen.getByRole('button', {name: `${name}, Pending`})).toBeInTheDocument();
  });

  test('includes dependency context in the job node accessible name', () => {
    render(
      <WorkflowJobsGraph
        run={makeRun({
          jobs: [
            makeJob({name: 'build'}),
            makeJob({name: 'deploy', position: 1, dependencies: ['build'], status: 'running'}),
          ],
        })}
      />,
    );

    expect(
      screen.getByRole('button', {name: 'deploy, Running, Depends on build'}),
    ).toBeInTheDocument();
    expect(screen.getByText('Depends on 1 job')).toBeInTheDocument();
  });

  test('summarizes multiple dependencies visually and keeps names accessible', () => {
    render(
      <WorkflowJobsGraph
        run={makeRun({
          jobs: [
            makeJob({name: 'build'}),
            makeJob({name: 'lint', position: 1}),
            makeJob({name: 'deploy', position: 2, dependencies: ['build', 'lint']}),
          ],
        })}
      />,
    );

    expect(
      screen.getByRole('button', {name: 'deploy, Pending, Depends on build, lint'}),
    ).toBeInTheDocument();
    expect(screen.getByText('Depends on 2 jobs')).toBeInTheDocument();
  });

  test('moves selection and focus with graph keyboard navigation', async () => {
    const user = userEvent.setup();
    render(
      <WorkflowJobsGraph
        run={makeRun({
          jobs: [
            makeJob({name: 'build'}),
            makeJob({name: 'deploy', position: 1, dependencies: ['build']}),
          ],
        })}
      />,
    );

    const build = screen.getByRole('button', {name: 'build, Pending'});
    const deploy = screen.getByRole('button', {name: 'deploy, Pending, Depends on build'});
    build.focus();

    await user.keyboard('{ArrowRight}');

    expect(deploy).toHaveFocus();
    expect(deploy).toHaveAttribute('aria-pressed', 'true');
    expect(build).toHaveAttribute('aria-pressed', 'false');
  });

  test('routes skipped-column join edges away from intermediate nodes', () => {
    const packageJob = makeJob({name: 'package', position: 0, status: 'succeeded'});
    const securityScan = makeJob({name: 'security-scan', position: 1, status: 'succeeded'});
    const smokeTests = makeJob({
      name: 'smoke-tests',
      position: 2,
      dependencies: ['package'],
      status: 'running',
    });
    const deploy = makeJob({
      name: 'deploy',
      position: 3,
      dependencies: ['smoke-tests', 'security-scan'],
    });

    const {container} = render(
      <WorkflowJobsGraph run={makeRun({jobs: [packageJob, securityScan, smokeTests, deploy]})} />,
    );

    const skippedJoinEdge = container.querySelector(
      `[data-edge-id="${securityScan.id}:${deploy.id}"]`,
    );
    expect(skippedJoinEdge).toHaveAttribute('d', 'M 332 151 H 648 V 55 H 684');
  });
});

function makeRun(overrides: Partial<RunDetailResponseDto> = {}): RunDetailResponseDto {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    project_id: '22222222-2222-4222-8222-222222222222',
    definition_id: '33333333-3333-4333-8333-333333333333',
    name: 'Deploy',
    status: 'running',
    trigger_source: 'manual',
    trigger_event: 'fire',
    trigger_payload: {},
    inputs: null,
    source_snapshot: null,
    created_at: '2026-06-21T12:00:00.000Z',
    updated_at: '2026-06-21T12:01:00.000Z',
    started_at: '2026-06-21T12:00:10.000Z',
    finished_at: null,
    jobs: [],
    ...overrides,
  };
}

let jobSequence = 0;
function makeJob(overrides: Partial<RunJobDetailDto> & {name: string}): RunJobDetailDto {
  jobSequence += 1;
  const {name, ...rest} = overrides;
  return {
    id: `44444444-4444-4444-8444-${String(jobSequence).padStart(12, '0')}`,
    run_id: '11111111-1111-4111-8111-111111111111',
    name,
    status: 'pending',
    dependencies: [],
    position: jobSequence,
    created_at: '2026-06-21T12:00:00.000Z',
    updated_at: '2026-06-21T12:01:00.000Z',
    queued_at: null,
    started_at: null,
    finished_at: null,
    steps: [],
    ...rest,
  };
}
