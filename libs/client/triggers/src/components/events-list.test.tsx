import type {TriggerEventListItemDto} from '@shipfox/api-triggers-dto';
import {RelativeTimeProvider} from '@shipfox/react-ui';
import {render, screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {EventsList} from './events-list.js';
import type {EventsListProps} from './types.js';

function makeEvent(overrides: Partial<TriggerEventListItemDto> = {}): TriggerEventListItemDto {
  return {
    id: 'evt-1',
    event_ref: 'ref-1',
    origin: 'integration',
    workspace_id: 'ws-1',
    source: 'github',
    event: 'push',
    delivery_id: 'delivery-1',
    connection_id: 'conn-1',
    outcome: 'routed',
    matched_count: 2,
    received_at: '2026-06-01T00:00:00.000Z',
    processed_at: '2026-06-01T00:00:00.000Z',
    created_at: '2026-06-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeProps(overrides: Partial<EventsListProps> = {}): EventsListProps {
  return {
    events: [makeEvent()],
    query: {
      isPending: false,
      isError: false,
      isFetching: false,
      data: {pages: [], pageParams: []},
      error: null,
      refetch: () => undefined,
    },
    facets: {sources: [{value: 'github', count: 1}], events: [{value: 'push', count: 1}]},
    filters: {},
    onFiltersChange: vi.fn(),
    workspaceId: 'ws-1',
    hasNextPage: false,
    isFetchingNextPage: false,
    onLoadMore: vi.fn(),
    ...overrides,
  };
}

function renderList(props: EventsListProps) {
  return render(
    <RelativeTimeProvider>
      <EventsList {...props} />
    </RelativeTimeProvider>,
  );
}

async function selectOutcome(label: string) {
  const user = userEvent.setup();

  await user.click(screen.getByRole('combobox', {name: 'Filter by outcome'}));
  await user.click(await screen.findByRole('option', {name: label}));
}

describe('EventsList', () => {
  test('renders a row per event with its match summary', () => {
    renderList(makeProps());

    expect(screen.getByText('→ 2 runs')).toBeInTheDocument();
  });

  test('still renders rows when the facets query failed', () => {
    renderList(makeProps({facets: undefined}));

    expect(screen.getByText('→ 2 runs')).toBeInTheDocument();
  });

  test('shows the no-matches state and clears active filters', async () => {
    const onFiltersChange = vi.fn();
    renderList(makeProps({events: [], filters: {outcome: ['failed']}, onFiltersChange}));

    expect(screen.getByText('No matching events')).toBeInTheDocument();

    // Both the filter bar and the empty state expose a "Clear filters" button; either clears.
    const [clearButton] = screen.getAllByRole('button', {name: 'Clear filters'});
    if (!clearButton) throw new Error('expected a Clear filters button');
    await userEvent.click(clearButton);

    expect(onFiltersChange).toHaveBeenCalledWith(expect.objectContaining({outcome: undefined}));
  });

  test('empty list filters do not count as active filters', () => {
    renderList(makeProps({filters: {source: [], event: [], outcome: []}}));

    expect(screen.getByText('→ 2 runs')).toBeInTheDocument();
    expect(screen.queryByRole('button', {name: 'Clear filters'})).not.toBeInTheDocument();
  });

  test('selecting an outcome reports the filter patch', async () => {
    const onFiltersChange = vi.fn();
    renderList(makeProps({onFiltersChange}));

    await selectOutcome('Routed');

    expect(onFiltersChange).toHaveBeenCalledWith({outcome: ['routed']});
  });

  test('removing the last active outcome clears the filter to undefined', async () => {
    const onFiltersChange = vi.fn();
    renderList(makeProps({filters: {outcome: ['routed']}, onFiltersChange}));

    await userEvent.click(screen.getByLabelText('Remove Routed'));

    expect(onFiltersChange).toHaveBeenCalledWith({outcome: undefined});
  });

  test('the Failed option folds errored in with failed', async () => {
    const onFiltersChange = vi.fn();
    renderList(makeProps({onFiltersChange}));

    await selectOutcome('Failed');

    expect(onFiltersChange).toHaveBeenCalledWith({outcome: ['failed', 'errored']});
  });

  test('an errored-only filter shows Failed as selected', () => {
    renderList(makeProps({filters: {outcome: ['errored']}}));

    expect(screen.getByLabelText('Remove Failed')).toBeInTheDocument();
  });
});
