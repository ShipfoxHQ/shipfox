import {type JobDto, jobDtoSchema} from '@shipfox/api-workflows-dto';
import {fireEvent, render, screen, within} from '@testing-library/react';
import {type WorkflowJobDto, WorkflowJobsVisualization} from './workflow-jobs-visualization.js';

const DEPLOY_BUTTON_LABEL_PATTERN = /^deploy\b/;
const BUILD_BUTTON_LABEL_PATTERN = /^build\b/;
const NEEDS_BUILD_PATTERN = /↳ needs build/;
const JOB_NAME_PATTERN = /^(build|test|deploy)$/;

function makeJob(overrides: Partial<JobDto>): WorkflowJobDto {
  const job = {
    id: '018fd019-2b2b-7cc3-98d4-0b4f91b7f001',
    run_id: '018fd019-2b2b-7cc3-98d4-0b4f91b7e000',
    name: 'build',
    status: 'succeeded',
    dependencies: [],
    position: 0,
    created_at: '2026-06-16T10:00:00.000Z',
    updated_at: '2026-06-16T10:01:00.000Z',
    ...overrides,
  };

  return jobDtoSchema.parse(job);
}

describe('WorkflowJobsVisualization', () => {
  test('renders a single job with its status inside the execution graph', () => {
    const jobs = [makeJob({name: 'build', status: 'succeeded'})];

    render(<WorkflowJobsVisualization jobs={jobs} />);

    expect(screen.getByRole('region', {name: 'Workflow jobs'})).toBeInTheDocument();
    expect(screen.getByText('1 job in this run')).toBeInTheDocument();
    expect(screen.getByText('trigger')).toBeInTheDocument();
    expect(screen.getByText('build')).toBeInTheDocument();
    expect(screen.getByText('Succeeded')).toBeInTheDocument();
  });

  test('lays out dependent jobs left to right with a needs hint', () => {
    const build = makeJob({
      id: '018fd019-2b2b-7cc3-98d4-0b4f91b7f001',
      name: 'build',
      position: 0,
    });
    const test = makeJob({
      id: '018fd019-2b2b-7cc3-98d4-0b4f91b7f002',
      name: 'test',
      dependencies: [build.id],
      position: 1,
    });
    const deploy = makeJob({
      id: '018fd019-2b2b-7cc3-98d4-0b4f91b7f003',
      name: 'deploy',
      dependencies: [test.id],
      position: 2,
    });

    render(<WorkflowJobsVisualization jobs={[deploy, test, build]} />);

    expect(screen.getByText('3 jobs in this run')).toBeInTheDocument();
    const nodeNames = screen
      .getAllByRole('listitem')
      .flatMap((item) => within(item).queryAllByText(JOB_NAME_PATTERN))
      .map((node) => node.textContent);
    expect(nodeNames).toEqual(['build', 'test', 'deploy']);
    expect(screen.getByText('↳ needs build')).toBeInTheDocument();
    expect(screen.getByText('↳ needs test')).toBeInTheDocument();
  });

  test('renders selected job state and calls the selection callback', () => {
    const onSelectJob = vi.fn();
    const build = makeJob({id: '018fd019-2b2b-7cc3-98d4-0b4f91b7f001', name: 'build'});
    const deploy = makeJob({
      id: '018fd019-2b2b-7cc3-98d4-0b4f91b7f002',
      name: 'deploy',
      dependencies: [build.id],
      position: 1,
    });

    render(
      <WorkflowJobsVisualization
        jobs={[build, deploy]}
        selectedJobId={deploy.id}
        onSelectJob={onSelectJob}
      />,
    );

    const deployButton = screen.getByRole('button', {name: DEPLOY_BUTTON_LABEL_PATTERN});
    expect(deployButton).toHaveAttribute('aria-pressed', 'true');
    const buildButton = screen.getByRole('button', {name: BUILD_BUTTON_LABEL_PATTERN});
    expect(buildButton).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(buildButton);

    expect(onSelectJob).toHaveBeenCalledWith(build.id);
  });

  test('renders job nodes as static articles when no selection handler is given', () => {
    render(<WorkflowJobsVisualization jobs={[makeJob({name: 'build'})]} />);

    expect(
      screen.queryByRole('button', {name: BUILD_BUTTON_LABEL_PATTERN}),
    ).not.toBeInTheDocument();
    expect(screen.getByText('build').closest('article')).not.toBe(null);
  });

  test('renders focused job state independently from selection', () => {
    const build = makeJob({id: '018fd019-2b2b-7cc3-98d4-0b4f91b7f001', name: 'build'});
    const test = makeJob({
      id: '018fd019-2b2b-7cc3-98d4-0b4f91b7f002',
      name: 'test',
      position: 1,
    });

    render(<WorkflowJobsVisualization jobs={[build, test]} focusedJobId={test.id} />);

    expect(screen.getByText('test').closest('article')).toHaveClass('bg-background-highlight-base');
    expect(screen.getByText('build').closest('article')).not.toHaveClass(
      'bg-background-highlight-base',
    );
  });

  test('surfaces failed upstream dependencies as blocked downstream state', () => {
    const build = makeJob({
      id: '018fd019-2b2b-7cc3-98d4-0b4f91b7f001',
      name: 'build',
      status: 'failed',
      position: 0,
    });
    const deploy = makeJob({
      id: '018fd019-2b2b-7cc3-98d4-0b4f91b7f002',
      name: 'deploy',
      status: 'waiting_for_dependencies',
      dependencies: [build.id],
      position: 1,
    });

    render(<WorkflowJobsVisualization jobs={[build, deploy]} />);

    const deployCard = screen.getByText('deploy').closest('article');
    expect(deployCard).not.toBe(null);
    expect(within(deployCard as HTMLElement).getByText('Blocked')).toBeInTheDocument();
    expect(within(deployCard as HTMLElement).getByText(NEEDS_BUILD_PATTERN)).toBeInTheDocument();
  });

  test('renders cancelled and unknown statuses without failing', () => {
    render(
      <WorkflowJobsVisualization
        jobs={[
          makeJob({name: 'cleanup', status: 'cancelled'}),
          makeJob({
            id: '018fd019-2b2b-7cc3-98d4-0b4f91b7f002',
            name: 'audit',
            status: 'runner_disappeared',
            position: 1,
          }),
        ]}
      />,
    );

    expect(screen.getByText('Cancelled')).toBeInTheDocument();
    expect(screen.getByText('Runner Disappeared')).toBeInTheDocument();
  });

  test('renders an empty state when a run has no jobs', () => {
    render(<WorkflowJobsVisualization jobs={[]} />);

    expect(screen.getByText('No jobs were recorded for this run.')).toBeInTheDocument();
  });
});
