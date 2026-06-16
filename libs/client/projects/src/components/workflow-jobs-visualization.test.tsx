import {
  type JobDto,
  jobDtoSchema,
  type StepAttemptDto,
  type StepDto,
  stepAttemptDtoSchema,
  stepDtoSchema,
} from '@shipfox/api-workflows-dto';
import {fireEvent, render, screen, within} from '@testing-library/react';
import {z} from 'zod';
import {type WorkflowJobDto, WorkflowJobsVisualization} from './workflow-jobs-visualization.js';

const GATE_LABEL_PATTERN = /gate/i;
const RESTART_LABEL_PATTERN = /restart/i;
const DEPLOY_BUTTON_LABEL_PATTERN = /^deploy\b/;
const BUILD_BUTTON_LABEL_PATTERN = /^build\b/;

const jobWithStepsSchema = jobDtoSchema.extend({
  steps: z.array(stepDtoSchema.extend({attempts: z.array(stepAttemptDtoSchema)})).optional(),
});

type WorkflowJobStep = StepDto & {attempts: StepAttemptDto[]};

function makeJob(overrides: Partial<JobDto> & {steps?: WorkflowJobDto['steps']}): WorkflowJobDto {
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

  return jobWithStepsSchema.parse(job);
}

function makeStep(overrides: Partial<StepDto> & {attempts?: StepAttemptDto[]}): WorkflowJobStep {
  const step = {
    id: '018fd019-2b2b-7cc3-98d4-0b4f91b7f101',
    job_id: '018fd019-2b2b-7cc3-98d4-0b4f91b7f001',
    name: 'Install',
    source_location: null,
    status: 'succeeded',
    type: 'run',
    config: {run: 'pnpm install'},
    error: null,
    position: 0,
    current_attempt: 1,
    created_at: '2026-06-16T10:00:00.000Z',
    updated_at: '2026-06-16T10:01:00.000Z',
    attempts: [],
    ...overrides,
  };

  return stepDtoSchema.extend({attempts: z.array(stepAttemptDtoSchema)}).parse(step);
}

function makeAttempt(overrides: Partial<StepAttemptDto>): StepAttemptDto {
  const attempt = {
    id: '018fd019-2b2b-7cc3-98d4-0b4f91b7f201',
    step_id: '018fd019-2b2b-7cc3-98d4-0b4f91b7f101',
    job_id: '018fd019-2b2b-7cc3-98d4-0b4f91b7f001',
    attempt: 1,
    status: 'succeeded',
    exit_code: 0,
    output: null,
    error: null,
    gate_result: null,
    restart_reason: null,
    restart_result: null,
    started_at: '2026-06-16T10:00:00.000Z',
    finished_at: '2026-06-16T10:01:00.000Z',
    ...overrides,
  };

  return stepAttemptDtoSchema.parse(attempt);
}

describe('WorkflowJobsVisualization', () => {
  test('renders a single job with status and step count', () => {
    const jobs = [makeJob({name: 'build', steps: [makeStep({})]})];

    render(<WorkflowJobsVisualization jobs={jobs} />);

    expect(screen.getByRole('region', {name: 'Workflow jobs'})).toBeInTheDocument();
    expect(screen.getByText('1 job across 1 stage')).toBeInTheDocument();
    expect(screen.getByText('build')).toBeInTheDocument();
    expect(screen.getByText('Succeeded')).toBeInTheDocument();
    expect(screen.getByText('1 step')).toBeInTheDocument();
  });

  test('lays out dependent jobs by stage and shows dependency chips', () => {
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

    expect(screen.getByText('3 jobs across 3 stages')).toBeInTheDocument();
    expect(screen.getByRole('region', {name: 'Stage 1'})).toHaveTextContent('build');
    expect(screen.getByRole('region', {name: 'Stage 2'})).toHaveTextContent('test');
    expect(screen.getByRole('region', {name: 'Stage 3'})).toHaveTextContent('deploy');
    expect(screen.getAllByText('Needs')).toHaveLength(2);
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

    fireEvent.click(screen.getByRole('button', {name: BUILD_BUTTON_LABEL_PATTERN}));

    expect(onSelectJob).toHaveBeenCalledWith(build.id);
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
    expect(within(deployCard as HTMLElement).getByText('Blocked by build')).toBeInTheDocument();
    expect(screen.getByText('1 failed')).toBeInTheDocument();
    expect(screen.getByText('1 blocked')).toBeInTheDocument();
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

  test('shows attempt-cycle markers from typed attempt numbers only', () => {
    const attempts = [
      makeAttempt({attempt: 1, status: 'failed', exit_code: 1}),
      makeAttempt({
        id: '018fd019-2b2b-7cc3-98d4-0b4f91b7f202',
        attempt: 2,
        status: 'succeeded',
        exit_code: 0,
      }),
    ];

    render(
      <WorkflowJobsVisualization
        jobs={[
          makeJob({
            name: 'deploy',
            steps: [makeStep({current_attempt: 2, attempts})],
          }),
        ]}
      />,
    );

    expect(screen.getByText('Attempt 2')).toBeInTheDocument();
  });

  test('does not render gate or restart labels from opaque audit blobs', () => {
    const attempt = makeAttempt({
      gate_result: {kind: 'unknown', data: {kind: 'evaluated', passed: false}},
      restart_reason: 'gate_failed',
    });

    render(
      <WorkflowJobsVisualization
        jobs={[makeJob({name: 'deploy', steps: [makeStep({attempts: [attempt]})]})]}
      />,
    );

    expect(screen.queryByText(GATE_LABEL_PATTERN)).not.toBeInTheDocument();
    expect(screen.queryByText(RESTART_LABEL_PATTERN)).not.toBeInTheDocument();
  });

  test('renders an empty state when a run has no jobs', () => {
    render(<WorkflowJobsVisualization jobs={[]} />);

    expect(screen.getByText('No jobs were recorded for this run.')).toBeInTheDocument();
  });
});
