import {configureApiClient} from '@shipfox/client-api';
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {fireEvent, render, screen, within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {secret, variableListItem} from '#test/fixtures/secrets.js';
import {WorkspaceSecretsSection} from './workspace-secrets-section.js';
import {WorkspaceVariablesSection} from './workspace-variables-section.js';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const ROW_COUNT = 51;
const NAME_HEADER = /^Name,/;
const UPDATED_HEADER = /^Last edited/;

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    headers: {'content-type': 'application/json'},
    status: 200,
  });
}

function makeKey(index: number) {
  return `STORE_KEY_${String(index).padStart(3, '0')}`;
}

function makeUpdatedAt(index: number) {
  return new Date(Date.UTC(2026, 0, index + 1)).toISOString();
}

function secretRows() {
  return Array.from({length: ROW_COUNT}, (_, index) =>
    secret({key: makeKey(index), updated_at: makeUpdatedAt(index)}),
  ).reverse();
}

function variableRows() {
  return Array.from({length: ROW_COUNT}, (_, index) =>
    variableListItem({key: makeKey(index), updated_at: makeUpdatedAt(index)}),
  ).reverse();
}

function renderStoreSection(fetchImpl: typeof fetch, section: 'secrets' | 'variables') {
  configureApiClient({baseUrl: 'https://api.example.test', fetchImpl});
  const queryClient = new QueryClient({defaultOptions: {queries: {retry: false}}});
  const Section = section === 'secrets' ? WorkspaceSecretsSection : WorkspaceVariablesSection;

  return render(
    <QueryClientProvider client={queryClient}>
      <Section workspaceId={WORKSPACE_ID} />
    </QueryClientProvider>,
  );
}

function rowIds() {
  return within(screen.getByRole('table'))
    .getAllByRole('row')
    .slice(1)
    .map((row) => row.getAttribute('data-row-id'));
}

describe('workspace store DataTables', () => {
  test.each([
    'secrets',
    'variables',
  ] as const)('%s keeps the table shape while loading', (section) => {
    const fetchImpl = (() => new Promise<Response>(() => undefined)) as unknown as typeof fetch;

    renderStoreSection(fetchImpl, section);

    const table = screen.getByRole('table');
    expect(within(table).getAllByRole('columnheader')).toHaveLength(4);
    expect(within(table).getAllByRole('cell')[0]).toHaveAttribute('colspan', '4');
  });

  test.each([
    ['secrets', secretRows],
    ['variables', variableRows],
  ] as const)('%s sorts and filters the complete result set', async (section, makeRows) => {
    const user = userEvent.setup();
    const rows = makeRows();
    const resource = section;
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({[resource]: rows, next_cursor: null}),
      ) as unknown as typeof fetch;

    renderStoreSection(fetchImpl, section);

    await screen.findByText('STORE_KEY_050');
    expect(rowIds()).toHaveLength(ROW_COUNT);

    const nameHeader = screen.getByRole('button', {name: NAME_HEADER});
    await user.click(nameHeader);
    expect(rowIds()).toEqual([
      'STORE_KEY_000',
      ...Array.from({length: ROW_COUNT - 2}, (_, index) => makeKey(index + 1)),
      'STORE_KEY_050',
    ]);

    const updatedHeader = screen.getByRole('button', {name: UPDATED_HEADER});
    await user.click(updatedHeader);
    expect(rowIds()[0]).toBe('STORE_KEY_000');
    await user.click(updatedHeader);
    expect(rowIds()[0]).toBe('STORE_KEY_050');

    const searchLabel = section === 'secrets' ? 'Search secrets' : 'Search variables';
    fireEvent.change(screen.getByRole('textbox', {name: searchLabel}), {
      target: {value: 'STORE_KEY_050'},
    });
    expect(rowIds()).toEqual(['STORE_KEY_050']);
    expect(screen.getByText('STORE_KEY_050')).toBeInTheDocument();
    expect(screen.queryByText('STORE_KEY_000')).not.toBeInTheDocument();
  });
});
