import {type RunDto, runDtoSchema} from '@shipfox/api-workflows-dto';
import {fireEvent, render, screen, within} from '@testing-library/react';
import {toWorkflowRunsListItem, WorkflowRunsList} from './workflow-runs-list.js';

const PROJECT_ID = '44444444-4444-4444-8444-444444444444';
const DEFINITION_ID = '55555555-5555-4555-8555-555555555555';
const FAILED_RUN_ID = '11111111-1111-4111-8111-111111111111';
const RUNNING_RUN_ID = '22222222-2222-4222-8222-222222222222';
const SUCCEEDED_RUN_ID = '33333333-3333-4333-8333-333333333333';
const FAILED_RUN_LABEL_RE = /#11111111/i;
const RUNNING_RUN_LABEL_RE = /#22222222/i;
const SUCCEEDED_RUN_LABEL_RE = /#33333333/i;

describe('WorkflowRunsList', () => {
  test('renders mixed run statuses from DTO-derived runs', () => {
    render(<WorkflowRunsList runs={mixedRuns()} selectedRunId={FAILED_RUN_ID} />);

    expect(screen.getByRole('heading', {name: 'Runs'})).toBeInTheDocument();
    expect(screen.getByText('#11111111')).toBeInTheDocument();
    expect(screen.getByText('#22222222')).toBeInTheDocument();
    expect(screen.getByText('#33333333')).toBeInTheDocument();
    const runHistory = screen.getByRole('navigation', {name: 'Run history'});
    expect(within(runHistory).getByText('Failed')).toBeInTheDocument();
    expect(within(runHistory).getByText('Running')).toBeInTheDocument();
    expect(within(runHistory).getByText('Succeeded')).toBeInTheDocument();
  });

  test('marks the selected run and calls onSelectRun from a row button', () => {
    const onSelectRun = vi.fn();
    const onCollapse = vi.fn();

    render(
      <WorkflowRunsList
        runs={mixedRuns()}
        selectedRunId={RUNNING_RUN_ID}
        onSelectRun={onSelectRun}
        onCollapse={onCollapse}
      />,
    );

    const runningRow = screen.getByRole('button', {name: RUNNING_RUN_LABEL_RE});
    expect(runningRow).toHaveAttribute('aria-current', 'page');

    fireEvent.click(screen.getByRole('button', {name: 'Collapse runs list'}));
    fireEvent.click(screen.getByRole('button', {name: SUCCEEDED_RUN_LABEL_RE}));

    expect(onCollapse).toHaveBeenCalledOnce();
    expect(onSelectRun).toHaveBeenCalledWith(SUCCEEDED_RUN_ID);
  });

  test('marks only the selected row with the brand accent and aria-current', () => {
    render(<WorkflowRunsList runs={mixedRuns()} selectedRunId={FAILED_RUN_ID} />);

    const selectedRow = screen.getByRole('button', {name: FAILED_RUN_LABEL_RE});
    const otherRow = screen.getByRole('button', {name: RUNNING_RUN_LABEL_RE});

    expect(selectedRow).toHaveAttribute('aria-current', 'page');
    expect(selectedRow).toHaveClass('border-border-highlights-interactive');
    expect(otherRow).not.toHaveAttribute('aria-current');
    expect(otherRow).not.toHaveClass('border-border-highlights-interactive');
  });

  test('renders navigation hrefs when provided', () => {
    const onSelectRun = vi.fn();

    render(
      <WorkflowRunsList
        runs={mixedRuns()}
        selectedRunId={FAILED_RUN_ID}
        onSelectRun={onSelectRun}
        getRunHref={(run) => `/runs/${run.id}`}
      />,
    );

    const failedLink = screen.getByRole('link', {name: FAILED_RUN_LABEL_RE});
    expect(failedLink).toHaveAttribute('href', `/runs/${FAILED_RUN_ID}`);
    expect(failedLink).toHaveAttribute('aria-current', 'page');

    const clickResult = fireEvent.click(failedLink);

    expect(clickResult).toBe(false);
    expect(onSelectRun).toHaveBeenCalledOnce();
    expect(onSelectRun).toHaveBeenCalledWith(FAILED_RUN_ID);
  });

  test.each([
    ['pending', 'Pending'],
    ['cancelled', 'Cancelled'],
  ] as const)('renders the %s status', (status, label) => {
    render(<WorkflowRunsList runs={[runDto({status})]} />);

    const runHistory = screen.getByRole('navigation', {name: 'Run history'});
    expect(within(runHistory).getByText(label)).toBeInTheDocument();
  });

  test('filters locally by status and search query', () => {
    render(<WorkflowRunsList runs={mixedRuns()} />);

    fireEvent.click(screen.getByRole('button', {name: 'Failed'}));

    expect(screen.getByText('#11111111')).toBeInTheDocument();
    expect(screen.queryByText('#22222222')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', {name: 'All'}));
    fireEvent.change(screen.getByRole('textbox', {name: 'Search runs'}), {
      target: {value: 'manual / fire'},
    });

    expect(screen.getByText('#33333333')).toBeInTheDocument();
    expect(screen.queryByText('#11111111')).not.toBeInTheDocument();
    expect(screen.queryByText('#22222222')).not.toBeInTheDocument();
  });

  test('renders empty, no-match, loading, and error states', () => {
    const {rerender} = render(<WorkflowRunsList runs={[]} />);
    expect(screen.getByText('No runs yet')).toBeInTheDocument();

    rerender(<WorkflowRunsList runs={mixedRuns()} />);
    fireEvent.change(screen.getByRole('textbox', {name: 'Search runs'}), {
      target: {value: 'does-not-match'},
    });
    expect(screen.getByText('No matching runs')).toBeInTheDocument();

    rerender(<WorkflowRunsList runs={[]} loading />);
    expect(screen.getByLabelText('Loading runs')).toBeInTheDocument();

    const onRetry = vi.fn();
    rerender(<WorkflowRunsList runs={[]} error onRetry={onRetry} />);
    fireEvent.click(screen.getByRole('button', {name: 'Retry'}));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  test('keeps stale rows visible when a refetch errors', () => {
    const onRetry = vi.fn();

    render(<WorkflowRunsList runs={mixedRuns()} error onRetry={onRetry} />);

    expect(screen.getByRole('navigation', {name: 'Run history'})).toBeInTheDocument();
    expect(screen.getByText('#11111111')).toBeInTheDocument();
    expect(screen.getByText('Could not refresh workflow runs.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', {name: 'Retry'}));

    expect(onRetry).toHaveBeenCalledOnce();
  });

  test('hides trigger metadata when source and event are missing', () => {
    render(
      <WorkflowRunsList
        runs={[
          runDto({
            trigger_source: '',
            trigger_event: '',
          }),
        ]}
      />,
    );

    expect(screen.queryByText('/')).not.toBeInTheDocument();
    expect(screen.getByText('#66666666')).toBeInTheDocument();
    expect(screen.getByText('Run updated', {exact: false})).toBeInTheDocument();
  });

  test('renders partial trigger metadata without a separator', () => {
    render(<WorkflowRunsList runs={[runDto({trigger_source: 'manual', trigger_event: ''})]} />);

    expect(screen.getByText('manual')).toBeInTheDocument();
    expect(screen.queryByText('manual /')).not.toBeInTheDocument();
  });

  test('maps DTO fields into stable list item text', () => {
    const item = toWorkflowRunsListItem(
      runDto({
        id: FAILED_RUN_ID,
        name: 'Deploy checkout',
        status: 'failed',
        trigger_source: 'sentry',
        trigger_event: 'issue-regression',
      }),
    );

    expect(item).toMatchObject({
      id: FAILED_RUN_ID,
      label: '#11111111',
      statusLabel: 'Failed',
      triggerLabel: 'sentry / issue-regression',
    });
    expect(item.searchText).toContain('deploy checkout');
    expect(item.searchText).toContain('sentry / issue-regression');
  });
});

function mixedRuns() {
  return [
    runDto({
      id: FAILED_RUN_ID,
      name: 'Remediate checkout',
      status: 'failed',
      trigger_source: 'sentry',
      trigger_event: 'issue-regression',
      updated_at: '2026-06-12T11:10:00.000Z',
    }),
    runDto({
      id: RUNNING_RUN_ID,
      name: 'Validate checkout fix',
      status: 'running',
      trigger_source: 'schedule',
      trigger_event: 'nightly',
      updated_at: '2026-06-12T11:55:00.000Z',
    }),
    runDto({
      id: SUCCEEDED_RUN_ID,
      name: 'Deploy checkout',
      status: 'succeeded',
      trigger_source: 'manual',
      trigger_event: 'fire',
      updated_at: '2026-06-12T09:10:00.000Z',
    }),
  ];
}

function runDto(overrides: Partial<RunDto> = {}): RunDto {
  return runDtoSchema.parse({
    id: '66666666-6666-4666-8666-666666666666',
    project_id: PROJECT_ID,
    definition_id: DEFINITION_ID,
    name: 'Deploy production',
    status: 'succeeded',
    trigger_source: 'manual',
    trigger_event: 'fire',
    trigger_payload: {source: 'manual', event: 'fire'},
    inputs: null,
    source_snapshot: null,
    created_at: '2026-06-12T09:00:00.000Z',
    updated_at: '2026-06-12T09:10:00.000Z',
    ...overrides,
  });
}
