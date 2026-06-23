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

  test('toggling an outcome chip reports the filter patch', async () => {
    const onFiltersChange = vi.fn();
    renderList(makeProps({onFiltersChange}));

    await userEvent.click(screen.getByRole('button', {name: 'Routed'}));

    expect(onFiltersChange).toHaveBeenCalledWith({outcome: ['routed']});
  });

  test('un-toggling the last active outcome chip clears the filter to undefined', async () => {
    const onFiltersChange = vi.fn();
    renderList(makeProps({filters: {outcome: ['routed']}, onFiltersChange}));

    await userEvent.click(screen.getByRole('button', {name: 'Routed'}));

    expect(onFiltersChange).toHaveBeenCalledWith({outcome: undefined});
  });

  test('the Failed chip folds errored in with failed', async () => {
    const onFiltersChange = vi.fn();
    renderList(makeProps({onFiltersChange}));

    await userEvent.click(screen.getByRole('button', {name: 'Failed'}));

    expect(onFiltersChange).toHaveBeenCalledWith({outcome: ['failed', 'errored']});
  });

  test('an errored-only filter shows the Failed chip as active', () => {
    renderList(makeProps({filters: {outcome: ['errored']}}));

    expect(screen.getByRole('button', {name: 'Failed'})).toHaveAttribute('aria-pressed', 'true');
  });
});
