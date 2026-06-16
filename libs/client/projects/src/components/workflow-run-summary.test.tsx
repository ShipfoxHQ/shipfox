import {render, screen} from '@testing-library/react';
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
const payloadText = /payload/;

function renderSummary(run: Parameters<typeof WorkflowRunSummary>[0]['run']) {
  return render(
    <RelativeTimeProvider>
      <WorkflowRunSummary run={run} />
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
    renderSummary(run);

    expect(screen.getByRole('region', {name: 'Workflow run summary'})).toBeInTheDocument();
    expect(screen.getByText(`Run ${run.id.split('-')[0]}`)).toBeInTheDocument();
    expect(screen.getByText(run.name)).toBeInTheDocument();
    expect(screen.getByText(statusLabel)).toBeInTheDocument();
    expect(screen.getByText('sentry · issue_alert')).toBeInTheDocument();
    expect(screen.getByText('2 payload fields')).toBeInTheDocument();
  });

  test('renders created and updated relative timestamps', () => {
    renderSummary(failedWorkflowRunSummaryFixture);

    expect(screen.getByText(createdText)).toHaveTextContent('created 2h ago');
    expect(screen.getByText(updatedText)).toHaveTextContent('updated 1h ago');
  });

  test('falls back when trigger metadata is missing', () => {
    renderSummary(missingTriggerWorkflowRunSummaryFixture);

    expect(screen.getByText('unknown trigger')).toBeInTheDocument();
    expect(screen.queryByText(payloadText)).not.toBeInTheDocument();
  });

  test('provides an isolated preview fixture for failed, running, and succeeded runs', () => {
    render(<WorkflowRunSummaryPreview />);

    expect(screen.getByText('Run 43010000')).toBeInTheDocument();
    expect(screen.getByText('Run 43090000')).toBeInTheDocument();
    expect(screen.getByText('Run 42710000')).toBeInTheDocument();
  });
});
