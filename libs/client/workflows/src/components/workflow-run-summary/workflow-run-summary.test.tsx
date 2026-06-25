import {fireEvent, screen, waitFor, within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {workflowRun} from '#test/fixtures/workflow-run.js';
import {renderProjectPage} from '#test/pages.js';
import {WorkflowRunSummary} from './workflow-run-summary.js';

const RUN_ID = '66666666-6666-4666-8666-666666666666';
const originalScrollWidth = Object.getOwnPropertyDescriptor(
  window.HTMLElement.prototype,
  'scrollWidth',
);
const originalClientWidth = Object.getOwnPropertyDescriptor(
  window.HTMLElement.prototype,
  'clientWidth',
);

afterEach(() => {
  restoreElementWidthDescriptors();
});

describe('WorkflowRunSummary', () => {
  test('renders identity, status, trigger metadata, and trigger time', async () => {
    renderSummary();

    const summary = await screen.findByRole('region', {name: 'deploy-web'});

    expect(within(summary).getByRole('heading', {name: 'deploy-web'})).toBeInTheDocument();
    expect(within(summary).getAllByText('Running')).not.toHaveLength(0);
    expect(within(summary).getByText('manual / fire')).toBeInTheDocument();
    expect(within(summary).getByText('Triggered')).toBeInTheDocument();
    expect(within(summary).queryByText('Updated')).not.toBeInTheDocument();
  });

  test('keeps the full run id reachable from the keyboard', async () => {
    const user = userEvent.setup();
    renderSummary();

    await user.tab();

    expect(screen.getByRole('button', {name: `Copy run id ${RUN_ID}`})).toHaveFocus();
  });

  test('copies the full run id when clicked', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {writeText},
    });
    renderSummary();

    await user.click(await screen.findByRole('button', {name: `Copy run id ${RUN_ID}`}));

    expect(writeText).toHaveBeenCalledWith(RUN_ID);
    const copyButton = screen.getByRole('button', {name: `Copied run id ${RUN_ID}`});
    expect(copyButton).toBeInTheDocument();
    expect(copyButton).toHaveTextContent('66666666');
    expect(copyButton).not.toHaveTextContent('Copied');
    expect(await screen.findByRole('status')).toHaveTextContent('Copied');

    await waitFor(
      () => {
        expect(screen.queryByRole('status')).not.toBeInTheDocument();
      },
      {timeout: 3000},
    );
    expect(screen.getByRole('button', {name: `Copy run id ${RUN_ID}`})).toBeInTheDocument();
  });

  test('dismisses copy feedback on scroll', async () => {
    const user = userEvent.setup();
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {writeText: vi.fn().mockResolvedValue(undefined)},
    });
    renderSummary();

    await user.click(await screen.findByRole('button', {name: `Copy run id ${RUN_ID}`}));
    expect(await screen.findByRole('status')).toHaveTextContent('Copied');

    fireEvent.scroll(window);

    await waitFor(() => {
      expect(screen.queryByRole('status')).not.toBeInTheDocument();
    });
  });

  test('omits empty trigger metadata', async () => {
    renderSummary({trigger_source: '', trigger_event: ''});

    await screen.findByRole('region', {name: 'deploy-web'});

    expect(screen.queryByText('manual / fire')).not.toBeInTheDocument();
  });

  test('does not show a run name tooltip when the heading is not truncated', async () => {
    const user = userEvent.setup();
    setElementWidths({scrollWidth: 80, clientWidth: 120});
    renderSummary();

    await user.hover(await screen.findByRole('heading', {name: 'deploy-web'}));

    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  test('shows the full run name in a tooltip when the heading is truncated', async () => {
    const user = userEvent.setup();
    const runName = 'release-production-multi-region-with-canary-and-smoke-tests';
    setElementWidths({scrollWidth: 200, clientWidth: 120});
    renderSummary({name: runName});

    await user.hover(await screen.findByRole('heading', {name: runName}));

    expect(await screen.findByRole('tooltip')).toHaveTextContent(runName);
  });

  test('renders source control only when source is available', async () => {
    const user = userEvent.setup();
    const onSourceToggle = vi.fn();
    renderSummary(
      {source_snapshot: {format: 'yaml', content: 'name: deploy-web'}},
      {
        sourceAvailable: true,
        sourceOpen: false,
        sourcePanelId: 'workflow-source-panel',
        onSourceToggle,
      },
    );

    const sourceButton = await screen.findByRole('button', {name: 'Source'});
    await user.click(sourceButton);

    expect(sourceButton).toHaveAttribute('aria-controls', 'workflow-source-panel');
    expect(sourceButton).toHaveAttribute('aria-expanded', 'false');
    expect(onSourceToggle).toHaveBeenCalledTimes(1);
  });

  test('omits source control when source is unavailable', async () => {
    renderSummary();

    await screen.findByRole('region', {name: 'deploy-web'});

    expect(screen.queryByRole('button', {name: 'Source'})).not.toBeInTheDocument();
  });
});

function renderSummary(
  overrides: Parameters<typeof workflowRun>[0] = {},
  props: Omit<Parameters<typeof WorkflowRunSummary>[0], 'run'> = {},
) {
  const run = workflowRun({
    id: RUN_ID,
    project_id: '44444444-4444-4444-8444-444444444444',
    definition_id: '55555555-5555-4555-8555-555555555555',
    name: 'deploy-web',
    status: 'running',
    trigger_source: 'manual',
    trigger_event: 'fire',
    created_at: '2026-05-07T01:01:00.000Z',
    updated_at: '2026-05-07T01:02:00.000Z',
    ...overrides,
  });

  renderProjectPage('/workspaces/ws-demo/projects/proj-demo/runs/run-demo', () => (
    <WorkflowRunSummary run={run} {...props} />
  ));
}

function setElementWidths(widths: {scrollWidth: number; clientWidth: number}) {
  Object.defineProperty(window.HTMLElement.prototype, 'scrollWidth', {
    configurable: true,
    get: () => widths.scrollWidth,
  });
  Object.defineProperty(window.HTMLElement.prototype, 'clientWidth', {
    configurable: true,
    get: () => widths.clientWidth,
  });
}

function restoreElementWidthDescriptors() {
  if (originalScrollWidth) {
    Object.defineProperty(window.HTMLElement.prototype, 'scrollWidth', originalScrollWidth);
  } else {
    delete (window.HTMLElement.prototype as {scrollWidth?: number}).scrollWidth;
  }

  if (originalClientWidth) {
    Object.defineProperty(window.HTMLElement.prototype, 'clientWidth', originalClientWidth);
  } else {
    delete (window.HTMLElement.prototype as {clientWidth?: number}).clientWidth;
  }
}
