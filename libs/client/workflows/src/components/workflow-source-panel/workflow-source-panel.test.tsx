import {render, screen, within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {WorkflowSourcePanel} from './workflow-source-panel.js';

describe('WorkflowSourcePanel', () => {
  test('renders workflow source in a labelled dialog', async () => {
    renderPanel({open: true});

    const dialog = await screen.findByRole('dialog', {name: 'Workflow source'});

    expect(dialog).toHaveAttribute('id', 'workflow-source-panel');
    expect(within(dialog).getByText('workflow.yaml')).toBeInTheDocument();
    expect(within(dialog).getByText('jobs:')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', {name: 'Copy to clipboard'})).toBeInTheDocument();
    expect(within(dialog).getByRole('button', {name: 'Close source'})).toBeInTheDocument();
  });

  test('closes with Escape while focus is inside the sheet', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    renderPanel({open: true, onClose});

    (await screen.findByRole('button', {name: 'Close source'})).focus();
    await user.keyboard('{Escape}');

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test('closes from the close button through the sheet close path', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    renderPanel({open: true, onClose});

    await user.click(await screen.findByRole('button', {name: 'Close source'}));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test('does not expose sheet controls while closed', () => {
    renderPanel({open: false});

    expect(screen.queryByRole('dialog', {name: 'Workflow source'})).not.toBeInTheDocument();
    expect(screen.queryByRole('button', {name: 'Close source'})).not.toBeInTheDocument();
  });

  test('does not render a sheet without source content', () => {
    renderPanel({open: true, source: null});

    expect(screen.queryByRole('dialog', {name: 'Workflow source'})).not.toBeInTheDocument();
    expect(screen.queryByRole('button', {name: 'Close source'})).not.toBeInTheDocument();
  });
});

function renderPanel({
  open,
  source = {format: 'yaml', content: 'jobs:\n  build:\n    steps: []'},
  onClose = vi.fn(),
}: {
  open: boolean;
  source?: Parameters<typeof WorkflowSourcePanel>[0]['source'];
  onClose?: () => void;
}) {
  render(
    <WorkflowSourcePanel
      id="workflow-source-panel"
      open={open}
      source={source}
      onClose={onClose}
    />,
  );
}
