import {render, screen, within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {WorkflowSourcePanel} from './workflow-source-panel.js';

describe('WorkflowSourcePanel', () => {
  test('renders workflow source in a labelled region', async () => {
    renderPanel({open: true});

    const panel = await screen.findByRole('region', {name: 'Workflow source'});

    expect(within(panel).getByRole('heading', {name: 'Workflow source'})).toBeInTheDocument();
    expect(within(panel).getAllByText('workflow.yaml')).toHaveLength(2);
    expect(within(panel).getByText('jobs:')).toBeInTheDocument();
  });

  test('closes with Escape while focus is inside the panel', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    renderPanel({open: true, onClose});

    (await screen.findByRole('button', {name: 'Close source'})).focus();
    await user.keyboard('{Escape}');

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test('does not expose panel controls while closed', () => {
    renderPanel({open: false});

    expect(document.getElementById('workflow-source-panel')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.queryByRole('button', {name: 'Close source'})).not.toBeInTheDocument();
  });

  test('widens the panel from the resize separator with the keyboard', async () => {
    const user = userEvent.setup();
    renderPanel({open: true});

    const handle = await screen.findByRole('separator', {name: 'Resize source panel'});
    const initialWidth = Number(handle.getAttribute('aria-valuenow'));
    handle.focus();
    await user.keyboard('{ArrowLeft}');

    expect(Number(handle.getAttribute('aria-valuenow'))).toBeGreaterThan(initialWidth);
  });
});

function renderPanel({open, onClose = vi.fn()}: {open: boolean; onClose?: () => void}) {
  render(
    <WorkflowSourcePanel
      id="workflow-source-panel"
      open={open}
      source={{format: 'yaml', content: 'jobs:\n  build:\n    steps: []'}}
      onClose={onClose}
    />,
  );
}
