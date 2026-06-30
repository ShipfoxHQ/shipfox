import {render, screen, waitFor, within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {agentProviderEntry} from '#test/fixtures/agent-providers.js';
import {AgentProviderUsageModal} from './agent-provider-usage-modal.js';

function renderUsageModal() {
  const onOpenChange = vi.fn();
  const entry = agentProviderEntry({
    default_model: 'claude-opus-4-8',
    models: [
      {id: 'claude-opus-4-8', label: 'Claude Opus 4.8'},
      {id: '@cf/moonshotai/kimi-k2.7-code', label: 'Kimi K2.7 Code'},
    ],
  });

  render(
    <AgentProviderUsageModal
      entry={entry}
      initialModel="claude-opus-4-8"
      open
      onOpenChange={onOpenChange}
    />,
  );

  return {entry, onOpenChange};
}

describe('AgentProviderUsageModal', () => {
  test('changes the selected model in the workflow example', async () => {
    const user = userEvent.setup();

    renderUsageModal();
    expect(await screen.findByText('model: claude-opus-4-8')).toBeVisible();

    await user.click(screen.getByRole('button', {name: 'Model'}));
    await user.click(await screen.findByRole('option', {name: 'Kimi K2.7 Code'}));

    await waitFor(() =>
      expect(screen.getByRole('dialog', {name: 'Use Anthropic in a workflow'})).toHaveTextContent(
        "model: '@cf/moonshotai/kimi-k2.7-code'",
      ),
    );
    expect(screen.getByRole('dialog', {name: 'Use Anthropic in a workflow'})).not.toHaveTextContent(
      'model: claude-opus-4-8',
    );
  });

  test('renders reference model copy buttons', async () => {
    renderUsageModal();

    const list = await screen.findByRole('list');
    expect(within(list).getByText('Claude Opus 4.8')).toBeVisible();
    expect(within(list).getByRole('button', {name: 'Copy Claude Opus 4.8 id'})).toBeVisible();
    expect(within(list).getByRole('button', {name: 'Copy Kimi K2.7 Code id'})).toBeVisible();
  });

  test('copies the full model id', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {writeText},
    });

    renderUsageModal();
    await user.click(await screen.findByRole('button', {name: 'Copy Kimi K2.7 Code id'}));

    expect(writeText).toHaveBeenCalledWith('@cf/moonshotai/kimi-k2.7-code');
    expect(await screen.findByRole('status')).toHaveTextContent('Copied Kimi K2.7 Code id');
  });

  test('shows failed copy feedback', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockRejectedValue(new Error('denied'));
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {writeText},
    });
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: vi.fn().mockReturnValue(false),
    });

    renderUsageModal();
    await user.click(await screen.findByRole('button', {name: 'Copy Claude Opus 4.8 id'}));

    await waitFor(() => expect(document.execCommand).toHaveBeenCalledWith('copy'));
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Could not copy Claude Opus 4.8 id',
    );
  });
});
