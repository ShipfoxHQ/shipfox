import {render, screen, waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {testModelProviderEntries} from '#test/fixtures/model-providers.js';
import {AvailableProvidersGrid} from './available-providers-grid.js';

describe('AvailableProvidersGrid', () => {
  test('shows the search field when more than eight providers are available', () => {
    render(<AvailableProvidersGrid entries={testModelProviderEntries(9)} onSelect={vi.fn()} />);

    expect(screen.getByRole('searchbox', {name: 'Search providers'})).toBeVisible();
  });

  test('hides the search field when eight or fewer providers are available without a query', () => {
    render(<AvailableProvidersGrid entries={testModelProviderEntries(8)} onSelect={vi.fn()} />);

    expect(screen.queryByRole('searchbox', {name: 'Search providers'})).not.toBeInTheDocument();
    expect(screen.getByRole('list', {name: 'Available providers'})).toBeVisible();
    expect(screen.getByRole('status')).toHaveTextContent('');
  });

  test('keeps the search field mounted when a query is active and the entries shrink below the threshold', async () => {
    const user = userEvent.setup();
    const {rerender} = render(
      <AvailableProvidersGrid entries={testModelProviderEntries(9)} onSelect={vi.fn()} />,
    );
    await user.type(screen.getByRole('searchbox', {name: 'Search providers'}), 'provider 1');

    rerender(<AvailableProvidersGrid entries={testModelProviderEntries(8)} onSelect={vi.fn()} />);

    expect(screen.getByRole('searchbox', {name: 'Search providers'})).toHaveValue('provider 1');
  });

  test('clear search resets the query and returns focus to the input', async () => {
    const user = userEvent.setup();
    render(<AvailableProvidersGrid entries={testModelProviderEntries(9)} onSelect={vi.fn()} />);
    const search = screen.getByRole('searchbox', {name: 'Search providers'});

    await user.type(search, 'missing');
    await user.click(screen.getByRole('button', {name: 'Clear search'}));

    expect(search).toHaveValue('');
    await waitFor(() => expect(search).toHaveFocus());
    expect(screen.getByRole('button', {name: 'Configure Provider 0'})).toBeVisible();
  });

  test('announces the filtered result count while a query is active', async () => {
    const user = userEvent.setup();
    render(<AvailableProvidersGrid entries={testModelProviderEntries(9)} onSelect={vi.fn()} />);

    await user.type(screen.getByRole('searchbox', {name: 'Search providers'}), 'provider 1');

    expect(screen.getByRole('status')).toHaveTextContent('1 provider matches "provider 1"');
    expect(screen.getByRole('list', {name: 'Available providers matching search'})).toBeVisible();
  });
});
