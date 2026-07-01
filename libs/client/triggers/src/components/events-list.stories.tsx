import type {
  TriggerEventFacetsResponseDto,
  TriggerEventListItemDto,
  TriggerEventOutcomeDto,
} from '@shipfox/api-triggers-dto';
import {Code} from '@shipfox/react-ui';
import type {Decorator, Meta, StoryObj} from '@storybook/react';
import type {ReactNode} from 'react';
import {EventsList} from './events-list.js';
import type {TriggerEventsListQuery} from './types.js';

// Typed so meta's inferred type stays nameable (TS2883) under the package's tsconfig.
const withWidth: Decorator = (Story) => (
  <div className="w-[900px]">
    <Story />
  </div>
);

function makeQuery(overrides: Partial<TriggerEventsListQuery> = {}): TriggerEventsListQuery {
  return {
    isPending: false,
    isError: false,
    isFetching: false,
    data: {pages: [], pageParams: []},
    error: null,
    refetch: () => undefined,
    ...overrides,
  };
}

let seq = 0;
function makeEvent(
  outcome: TriggerEventOutcomeDto,
  provider: string | null,
  source: string,
  event: string,
  matchedCount: number,
  minutesAgo: number,
): TriggerEventListItemDto {
  seq += 1;
  return {
    id: `evt-${String(seq).padStart(8, '0')}`,
    event_ref: `ref-${seq}`,
    origin: 'integration',
    workspace_id: 'ws-demo',
    provider,
    source,
    event,
    delivery_id: `delivery-${String(seq).padStart(6, '0')}`,
    connection_id: 'conn-demo',
    outcome,
    matched_count: matchedCount,
    received_at: new Date(Date.now() - minutesAgo * 60_000).toISOString(),
    processed_at: new Date(Date.now() - minutesAgo * 60_000).toISOString(),
    created_at: new Date(Date.now() - minutesAgo * 60_000).toISOString(),
  };
}

const SAMPLE_EVENTS: TriggerEventListItemDto[] = [
  makeEvent('received', 'github', 'github_acme', 'push', 0, 0),
  makeEvent('routed', 'github', 'github_acme', 'push', 2, 3),
  makeEvent('routed', 'gitea', 'gitea_acme', 'pull_request', 1, 12),
  makeEvent('discarded', 'github', 'github_acme', 'issue_comment', 0, 38),
  makeEvent('failed', 'gitlab', 'gitlab_acme', 'push', 1, 95),
];

const SAMPLE_FACETS: TriggerEventFacetsResponseDto = {
  sources: [
    {value: 'github_acme', count: 3},
    {value: 'gitea_acme', count: 1},
    {value: 'gitlab_acme', count: 1},
  ],
  events: [
    {value: 'push', count: 3},
    {value: 'pull_request', count: 1},
    {value: 'issue_comment', count: 1},
  ],
};

const meta = {
  title: 'Triggers/EventsList',
  component: EventsList,
  parameters: {layout: 'padded'},
  decorators: [withWidth],
  args: {
    events: SAMPLE_EVENTS,
    query: makeQuery(),
    facets: SAMPLE_FACETS,
    filters: {},
    onFiltersChange: () => undefined,
    workspaceId: 'ws-demo',
    hasNextPage: false,
    isFetchingNextPage: false,
    onLoadMore: () => undefined,
    selectedEventId: 'evt-00000002',
    onSelectEvent: () => undefined,
  },
} satisfies Meta<typeof EventsList>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

export const DataStates: Story = {
  render: (args) => (
    <div className="flex flex-col gap-32">
      <StateExample label="Loading">
        <EventsList {...args} events={[]} query={makeQuery({isPending: true, data: undefined})} />
      </StateExample>
      <StateExample label="Empty">
        <EventsList {...args} events={[]} facets={{sources: [], events: []}} />
      </StateExample>
      <StateExample label="No matches">
        <EventsList {...args} events={[]} filters={{outcome: ['failed']}} />
      </StateExample>
      <StateExample label="Load error">
        <EventsList {...args} events={[]} query={makeQuery({isError: true, data: undefined})} />
      </StateExample>
    </div>
  ),
};

function StateExample({label, children}: {label: string; children: ReactNode}) {
  return (
    <div className="flex flex-col gap-8">
      <Code variant="label" className="text-foreground-neutral-subtle">
        {label}
      </Code>
      <div className="min-h-280 rounded-8 border border-border-neutral-base bg-background-neutral-base p-12">
        {children}
      </div>
    </div>
  );
}
