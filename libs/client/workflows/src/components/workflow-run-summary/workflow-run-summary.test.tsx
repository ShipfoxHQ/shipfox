import type {RunResponseDto} from '@shipfox/api-workflows-dto';
import {screen, within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {renderProjectPage} from '#test/pages.js';
import {WorkflowRunSummary} from './workflow-run-summary.js';

const RUN_ID = '66666666-6666-4666-8666-666666666666';

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
    expect(within(copyButton).getByText('Copied')).toBeInTheDocument();
  });

  test('omits empty trigger metadata', () => {
    renderSummary({trigger_source: '', trigger_event: ''});

    expect(screen.queryByText('manual / fire')).not.toBeInTheDocument();
  });
});

function renderSummary(overrides: Partial<RunResponseDto> = {}) {
  renderProjectPage('/workspaces/ws-demo/projects/proj-demo/runs/run-demo', () => (
    <WorkflowRunSummary
      run={{
        id: RUN_ID,
        project_id: '44444444-4444-4444-8444-444444444444',
        definition_id: '55555555-5555-4555-8555-555555555555',
        name: 'deploy-web',
        status: 'running',
        trigger_source: 'manual',
        trigger_event: 'fire',
        trigger_payload: {},
        inputs: null,
        source_snapshot: null,
        created_at: '2026-05-07T01:01:00.000Z',
        updated_at: '2026-05-07T01:02:00.000Z',
        started_at: null,
        finished_at: null,
        ...overrides,
      }}
    />
  ));
}
