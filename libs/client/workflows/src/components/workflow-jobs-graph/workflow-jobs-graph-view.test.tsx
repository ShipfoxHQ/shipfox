import type {RunJobDetailDto} from '@shipfox/api-workflows-dto';
import {fireEvent, render, screen, within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type {WorkflowJob, WorkflowRunDetail} from '#core/workflow-run.js';
import {workflowJob, workflowRunDetail} from '#test/fixtures/workflow-run.js';
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

  test('renders a downstream job skipped after an upstream failure', () => {
    render(
      <WorkflowJobsGraph
        run={makeRun({
          jobs: [
            makeJob({name: 'build', status: 'failed'}),
            makeJob({
              name: 'deploy',
              status: 'skipped',
              status_reason: 'dependency_not_completed',
              position: 1,
              dependencies: ['build'],
            }),
          ],
        })}
      />,
    );

    expect(screen.getByRole('button', {name: 'build, Failed'})).toBeInTheDocument();
    expect(screen.getByRole('button', {name: 'deploy, Skipped'})).toBeInTheDocument();
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
      screen.getByRole('button', {
        name: 'deploy, Running, 1 current dependency is still pending or running',
      }),
    ).toBeInTheDocument();
    expect(screen.queryByText('Depends on 1 job')).not.toBeInTheDocument();
  });

  test('summarizes multiple current dependencies visually and keeps count accessible', () => {
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

    const deploy = screen.getByRole('button', {
      name: 'deploy, Pending, 2 current dependencies are still pending or running',
    });
    expect(deploy).toBeInTheDocument();
    expect(within(deploy).getByText('2')).toBeInTheDocument();
    expect(screen.queryByText('Depends on 2 jobs')).not.toBeInTheDocument();
  });

  test('hides the current dependency pill when upstream jobs are resolved', () => {
    render(
      <WorkflowJobsGraph
        run={makeRun({
          jobs: [
            makeJob({name: 'build', status: 'succeeded'}),
            makeJob({name: 'deploy', position: 1, dependencies: ['build']}),
          ],
        })}
      />,
    );

    const deploy = screen.getByRole('button', {name: 'deploy, Pending'});
    expect(within(deploy).queryByText('1')).not.toBeInTheDocument();
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
    const deploy = screen.getByRole('button', {
      name: 'deploy, Pending, 1 current dependency is still pending or running',
    });
    build.focus();

    await user.keyboard('{ArrowRight}');

    expect(deploy).toHaveFocus();
    expect(deploy).toHaveAttribute('aria-pressed', 'true');
    expect(build).toHaveAttribute('aria-pressed', 'false');
  });

  test('highlights adjacent edges only while hovering a job', async () => {
    const user = userEvent.setup();
    const build = makeJob({name: 'build'});
    const deploy = makeJob({name: 'deploy', position: 1, dependencies: ['build']});
    const {container} = render(<WorkflowJobsGraph run={makeRun({jobs: [build, deploy]})} />);
    const triggerEdge = container.querySelector(`[data-edge-id="trigger:${build.id}"]`);
    const deployEdge = container.querySelector(`[data-edge-id="${build.id}:${deploy.id}"]`);
    const deployNode = screen.getByRole('button', {
      name: 'deploy, Pending, 1 current dependency is still pending or running',
    });

    fireEvent.click(deployNode);

    expect(deployEdge).toHaveAttribute('stroke-width', '1');

    await user.hover(deployNode);

    expect(deployEdge).toHaveAttribute('stroke-width', '1.5');
    expect(triggerEdge).toHaveAttribute('stroke-width', '1');

    await user.unhover(deployNode);

    expect(deployEdge).toHaveAttribute('stroke-width', '1');
  });

  test('draws highlighted edges above overlapping normal edges', async () => {
    const user = userEvent.setup();
    const build = makeJob({name: 'build', status: 'succeeded'});
    const lint = makeJob({
      name: 'lint',
      position: 1,
      dependencies: ['build'],
      status: 'succeeded',
    });
    const testJob = makeJob({
      name: 'test',
      position: 2,
      dependencies: ['build'],
      status: 'running',
    });
    const deploy = makeJob({
      name: 'deploy',
      position: 3,
      dependencies: ['lint', 'test'],
    });
    const {container} = render(
      <WorkflowJobsGraph run={makeRun({jobs: [build, lint, testJob, deploy]})} />,
    );
    const buildToLintEdge = container.querySelector(`[data-edge-id="${build.id}:${lint.id}"]`);
    const buildToTestEdge = container.querySelector(`[data-edge-id="${build.id}:${testJob.id}"]`);
    const testNode = screen.getByRole('button', {
      name: 'test, Running',
    });

    await user.hover(testNode);

    expect(buildToTestEdge).toHaveAttribute('stroke-width', '1.5');
    expect(buildToLintEdge).toHaveAttribute('stroke-width', '1');
    if (!buildToLintEdge || !buildToTestEdge) {
      throw new Error('Expected branch edges to render');
    }
    expect(buildToLintEdge.compareDocumentPosition(buildToTestEdge)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
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
    expect(skippedJoinEdge).toHaveAttribute('d', 'M 324 108 H 628 V 40 H 660');
  });
});

function makeRun(overrides: Partial<WorkflowRunDetail> = {}): WorkflowRunDetail {
  return {
    ...workflowRunDetail({
      name: 'Deploy',
      trigger_source: 'manual',
      trigger_event: 'fire',
      started_at: '2026-06-21T12:00:10.000Z',
      jobs: [],
    }),
    ...overrides,
  };
}

function makeJob(overrides: Partial<RunJobDetailDto> & {name: string}): WorkflowJob {
  return workflowJob(overrides);
}
