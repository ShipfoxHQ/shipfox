import {fireEvent, render, screen} from '@testing-library/react';
import {RelativeTimeProvider} from '#lib/relative-time.js';
import {
  failedWorkflowRunSummaryFixture,
  missingTriggerWorkflowRunSummaryFixture,
  runningWorkflowRunSummaryFixture,
  succeededWorkflowRunSummaryFixture,
} from './workflow-run-summary.fixtures.js';
import {WorkflowRunSummary} from './workflow-run-summary.js';
import {WorkflowRunSummaryPreview} from './workflow-run-summary.preview.js';

const createdText = /created/i;
const updatedText = /updated/i;
const jumpButtonName = /^Go to/;

function renderSummary(props: Parameters<typeof WorkflowRunSummary>[0]) {
  return render(
    <RelativeTimeProvider>
      <WorkflowRunSummary {...props} />
    </RelativeTimeProvider>,
  );
}

describe('WorkflowRunSummary', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.parse('2026-06-12T12:10:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test.each([
    [failedWorkflowRunSummaryFixture, 'Failed'],
    [runningWorkflowRunSummaryFixture, 'Running'],
    [succeededWorkflowRunSummaryFixture, 'Succeeded'],
  ])('renders the %s run status summary', (run, statusLabel) => {
    renderSummary({run});

    expect(screen.getByRole('region', {name: 'Workflow run summary'})).toBeInTheDocument();
    expect(screen.getByText(`Run ${run.id.split('-')[0]}`)).toBeInTheDocument();
    expect(screen.getByText(run.name)).toBeInTheDocument();
    expect(screen.getByText(statusLabel)).toBeInTheDocument();
    expect(screen.getByText('SENTRY-CHKOUT-9002')).toBeInTheDocument();
    expect(screen.getByText('sentry · issue_alert')).toBeInTheDocument();
    expect(screen.getByText('2 payload fields')).toBeInTheDocument();
  });

  test('renders created and updated relative timestamps', () => {
    renderSummary({run: failedWorkflowRunSummaryFixture});

    expect(screen.getByText(createdText)).toHaveTextContent('created 2h ago');
    expect(screen.getByText(updatedText)).toHaveTextContent('updated 1h ago');
  });

  test('falls back when trigger metadata is missing', () => {
    renderSummary({run: missingTriggerWorkflowRunSummaryFixture});

    expect(screen.getByText('unknown trigger')).toBeInTheDocument();
    expect(screen.getByText('0 payload fields')).toBeInTheDocument();
    expect(screen.getByText('no incident')).toBeInTheDocument();
  });

  test('exposes the full run id tooltip trigger to keyboard users', () => {
    renderSummary({run: failedWorkflowRunSummaryFixture});

    expect(
      screen.getByRole('button', {name: `Full run id ${failedWorkflowRunSummaryFixture.id}`}),
    ).toBeInTheDocument();
  });

  test('omits the source and jump affordances when no callbacks are provided', () => {
    renderSummary({run: failedWorkflowRunSummaryFixture});

    expect(screen.queryByRole('button', {name: 'Workflow source'})).not.toBeInTheDocument();
    expect(screen.queryByRole('button', {name: 'Go to root cause'})).not.toBeInTheDocument();
  });

  test('renders and wires the workflow source affordance when provided', () => {
    const onOpenSource = vi.fn();
    renderSummary({run: succeededWorkflowRunSummaryFixture, onOpenSource});

    fireEvent.click(screen.getByRole('button', {name: 'Workflow source'}));

    expect(onOpenSource).toHaveBeenCalledOnce();
  });

  test('labels the jump affordance "Go to root cause" for failed runs', () => {
    const onJump = vi.fn();
    renderSummary({run: failedWorkflowRunSummaryFixture, onJump});

    fireEvent.click(screen.getByRole('button', {name: 'Go to root cause'}));

    expect(onJump).toHaveBeenCalledOnce();
  });

  test('labels the jump affordance "Go to active step" for running runs', () => {
    renderSummary({run: runningWorkflowRunSummaryFixture, onJump: vi.fn()});

    expect(screen.getByRole('button', {name: 'Go to active step'})).toBeInTheDocument();
  });

  test('hides the jump affordance for statuses without a focus step', () => {
    renderSummary({run: succeededWorkflowRunSummaryFixture, onJump: vi.fn()});

    expect(screen.queryByRole('button', {name: jumpButtonName})).not.toBeInTheDocument();
  });

  test('provides an isolated preview fixture for failed, running, and succeeded runs', () => {
    render(<WorkflowRunSummaryPreview />);

    expect(screen.getByText('Run 43010000')).toBeInTheDocument();
    expect(screen.getByText('Run 43090000')).toBeInTheDocument();
    expect(screen.getByText('Run 42710000')).toBeInTheDocument();
  });
});
