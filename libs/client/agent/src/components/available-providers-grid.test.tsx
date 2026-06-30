import {render, screen, waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {agentProviderEntry} from '#test/fixtures/agent-providers.js';
import {AvailableProvidersGrid} from './available-providers-grid.js';

const TEST_PROVIDER_IDS = [
  'anthropic',
  'openai',
  'deepseek',
  'nvidia',
  'google',
  'mistral',
  'groq',
  'cerebras',
  'xai',
] as const;

function providerEntries(count: number) {
  return TEST_PROVIDER_IDS.slice(0, count).map((id, index) =>
    agentProviderEntry({
      id,
      label: `Provider ${index}`,
      default_model: `model-${index}`,
      models: [{id: `model-${index}`, label: `Model ${index}`}],
    }),
  );
}

describe('AvailableProvidersGrid', () => {
  test('shows the search field when more than eight providers are available', () => {
    render(<AvailableProvidersGrid entries={providerEntries(9)} onSelect={vi.fn()} />);

    expect(screen.getByRole('searchbox', {name: 'Search providers'})).toBeVisible();
  });

  test('hides the search field when eight or fewer providers are available without a query', () => {
    render(<AvailableProvidersGrid entries={providerEntries(8)} onSelect={vi.fn()} />);

    expect(screen.queryByRole('searchbox', {name: 'Search providers'})).not.toBeInTheDocument();
    expect(screen.getByRole('list', {name: 'Available providers'})).toBeVisible();
  });

  test('keeps the search field mounted when a query is active and the entries shrink below the threshold', async () => {
    const user = userEvent.setup();
    const {rerender} = render(
      <AvailableProvidersGrid entries={providerEntries(9)} onSelect={vi.fn()} />,
    );
    await user.type(screen.getByRole('searchbox', {name: 'Search providers'}), 'provider 1');

    rerender(<AvailableProvidersGrid entries={providerEntries(8)} onSelect={vi.fn()} />);

    expect(screen.getByRole('searchbox', {name: 'Search providers'})).toHaveValue('provider 1');
  });

  test('clear search resets the query and returns focus to the input', async () => {
    const user = userEvent.setup();
    render(<AvailableProvidersGrid entries={providerEntries(9)} onSelect={vi.fn()} />);
    const search = screen.getByRole('searchbox', {name: 'Search providers'});

    await user.type(search, 'missing');
    await user.click(screen.getByRole('button', {name: 'Clear search'}));

    expect(search).toHaveValue('');
    await waitFor(() => expect(search).toHaveFocus());
    expect(screen.getByRole('button', {name: 'Configure Provider 0'})).toBeVisible();
  });

  test('announces the filtered result count while a query is active', async () => {
    const user = userEvent.setup();
    render(<AvailableProvidersGrid entries={providerEntries(9)} onSelect={vi.fn()} />);

    await user.type(screen.getByRole('searchbox', {name: 'Search providers'}), 'provider 1');

    expect(screen.getByRole('status')).toHaveTextContent('1 provider matches "provider 1"');
    expect(screen.getByRole('list', {name: 'Available providers matching search'})).toBeVisible();
  });
});
