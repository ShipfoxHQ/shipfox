import {argosScreenshot} from '@argos-ci/storybook/vitest';
import type {TriggerEventDetailResponseDto} from '@shipfox/api-triggers-dto';
import {projectsQueryKeys} from '@shipfox/client-projects';
import {RelativeTimeProvider} from '@shipfox/react-ui/relative-time';
import type {Decorator, Meta, StoryObj} from '@storybook/react';
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router';
import {expect, screen} from 'storybook/test';
import {toTriggerEventDetail} from '#hooks/api/trigger-event-mapper.js';
import {TriggerEventDetailView} from './trigger-event-detail.js';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const PROJECT_ID = '22222222-2222-4222-8222-222222222222';
const RUN_ID = '33333333-3333-4333-8333-333333333333';

function minutesAgo(minutes: number): string {
  return new Date(Date.now() - minutes * 60_000).toISOString();
}

function createStoryQueryClient() {
  const queryClient = new QueryClient({
    defaultOptions: {queries: {staleTime: Number.POSITIVE_INFINITY, retry: false}},
  });
  queryClient.setQueryData(projectsQueryKeys.list(WORKSPACE_ID), {
    pages: [
      {projects: [{id: PROJECT_ID, slug: 'checkout-api', name: 'Checkout API'}], nextCursor: null},
    ],
    pageParams: [undefined],
  });
  return queryClient;
}

const withRouter: Decorator = (Story) => {
  const queryClient = createStoryQueryClient();

  function StoryRoute() {
    return (
      <QueryClientProvider client={queryClient}>
        <RelativeTimeProvider>
          <div className="min-h-screen bg-background-subtle-base p-24 [--app-content-h:calc(100dvh_-_96px)]">
            <div className="@container ml-auto w-[860px]">
              <Story />
            </div>
          </div>
        </RelativeTimeProvider>
      </QueryClientProvider>
    );
  }

  const rootRoute = createRootRoute({component: Outlet});
  const storyRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    component: StoryRoute,
  });
  const runRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/w/$workspaceSlug/p/$projectSlug/runs/$workflowRunId',
    component: StoryRoute,
  });
  const router = createRouter({
    history: createMemoryHistory({initialEntries: ['/']}),
    routeTree: rootRoute.addChildren([storyRoute, runRoute]),
  });

  return <RouterProvider router={router} />;
};

const routedEventDto: TriggerEventDetailResponseDto = {
  id: '44444444-4444-4444-8444-444444444444',
  event_ref: 'github:delivery-179:push',
  origin: 'integration',
  workspace_id: WORKSPACE_ID,
  provider: 'github',
  source: 'github_acme',
  event: 'push',
  replay_of_event_id: null,
  delivery_id: 'delivery-179',
  connection_id: '55555555-5555-4555-8555-555555555555',
  connection_name: 'ShipfoxHQ Production',
  outcome: 'routed',
  matched_count: 2,
  payload: {
    ref: 'refs/heads/main',
    repository: {full_name: 'ShipfoxHQ/platform'},
    head_commit: {id: '9f1a0f2c7a1b', message: 'Deploy event detail'},
  },
  received_at: minutesAgo(15),
  processed_at: '2026-06-25T19:30:02.000Z',
  created_at: '2026-06-25T19:30:00.000Z',
  decisions: [
    {
      id: '66666666-6666-4666-8666-666666666666',
      received_event_id: '44444444-4444-4444-8444-444444444444',
      subscription_kind: 'trigger',
      subscription_id: '77777777-7777-4777-8777-777777777777',
      subscription_name: 'Deploy production',
      workflow_definition_id: '88888888-8888-4888-8888-888888888888',
      project_id: PROJECT_ID,
      workflow_run_id: null,
      job_id: null,
      matcher_kind: null,
      matcher_ordinal: null,
      decision: 'triggered',
      run_id: RUN_ID,
      run_name: 'deploy-web #184',
      reason: null,
      created_at: '2026-06-25T19:30:02.000Z',
    },
    {
      id: '99999999-9999-4999-8999-999999999999',
      received_event_id: '44444444-4444-4444-8444-444444444444',
      subscription_kind: 'trigger',
      subscription_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      subscription_name: 'Mirror staging',
      workflow_definition_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      project_id: PROJECT_ID,
      workflow_run_id: null,
      job_id: null,
      matcher_kind: null,
      matcher_ordinal: null,
      decision: 'triggered',
      run_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      run_name: 'mirror-staging #51',
      reason: null,
      created_at: '2026-06-25T19:30:02.000Z',
    },
  ],
  replays: [],
};

const discardedEventDto: TriggerEventDetailResponseDto = {
  ...routedEventDto,
  id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  event_ref: 'github:delivery-180:issue_comment',
  event: 'issue_comment',
  delivery_id: 'delivery-180',
  outcome: 'discarded',
  matched_count: 0,
  payload: {action: 'created', comment: {body: '/preview'}},
  processed_at: '2026-06-25T19:33:01.000Z',
  decisions: [],
};

const routedDecision = routedEventDto.decisions[0];
if (routedDecision === undefined) throw new Error('Routed story decision is missing');

const failedFilterEventDto: TriggerEventDetailResponseDto = {
  ...routedEventDto,
  id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
  event_ref: 'github:delivery-181:on_pr_opened',
  event: 'on_pr_opened',
  delivery_id: 'delivery-181',
  outcome: 'errored',
  matched_count: 1,
  payload: {pull_request: {draft: false}},
  decisions: [
    {
      ...routedDecision,
      id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
      received_event_id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      subscription_name: 'on_pr_opened',
      decision: 'filter-error',
      run_id: null,
      run_name: null,
      reason: 'Trigger filter evaluation failed',
      diagnostic: {
        version: 1,
        code: 'expression-missing-path',
        path: 'trigger.repository',
      },
    },
  ],
};

const failedFilterDecision = failedFilterEventDto.decisions[0];
if (failedFilterDecision === undefined) throw new Error('Failed filter story decision is missing');

const groupedErrorsEventDto: TriggerEventDetailResponseDto = {
  ...failedFilterEventDto,
  id: '12121212-1212-4212-8212-121212121212',
  event_ref: 'github:delivery-182:on_pr_opened',
  delivery_id: 'delivery-182',
  matched_count: 2,
  decisions: [
    {
      ...failedFilterDecision,
      received_event_id: '12121212-1212-4212-8212-121212121212',
    },
    {
      ...failedFilterDecision,
      id: '13131313-1313-4313-8313-131313131313',
      received_event_id: '12121212-1212-4212-8212-121212121212',
      subscription_id: '14141414-1414-4414-8414-141414141414',
      subscription_name: 'deploy_preview',
    },
  ],
};

const partialFailureEventDto: TriggerEventDetailResponseDto = {
  ...failedFilterEventDto,
  id: '15151515-1515-4515-8515-151515151515',
  event_ref: 'github:delivery-183:on_pr_opened',
  delivery_id: 'delivery-183',
  outcome: 'routed',
  matched_count: 2,
  decisions: [
    {...routedDecision, received_event_id: '15151515-1515-4515-8515-151515151515'},
    {...failedFilterDecision, received_event_id: '15151515-1515-4515-8515-151515151515'},
  ],
};

const unavailableDetailsEventDto: TriggerEventDetailResponseDto = {
  ...failedFilterEventDto,
  id: '16161616-1616-4616-8616-161616161616',
  event_ref: 'github:delivery-184:on_pr_opened',
  delivery_id: 'delivery-184',
  decisions: [
    {
      ...failedFilterDecision,
      id: '17171717-1717-4717-8717-171717171717',
      received_event_id: '16161616-1616-4616-8616-161616161616',
      decision: 'dispatch-error',
      reason: 'internal host db.private.example failed',
      diagnostic: undefined,
    },
  ],
};

const scrollingEventDto: TriggerEventDetailResponseDto = {
  ...routedEventDto,
  id: '18181818-1818-4818-8818-181818181818',
  event_ref: 'github:delivery-185:push',
  delivery_id: 'delivery-185',
  payload: {
    commits: Array.from({length: 40}, (_, index) => ({
      id: `commit-${index + 1}`,
      message: `Update event detail fixture ${index + 1}`,
    })),
  },
};

const agentDecisionBase = {
  received_event_id: '19191919-1919-4919-8919-191919191919',
  subscription_kind: 'agent',
  workflow_definition_id: null,
  project_id: PROJECT_ID,
  workflow_run_id: null,
  job_id: null,
  matcher_kind: null,
  matcher_ordinal: null,
  run_id: null,
  run_name: null,
  reason: null,
  created_at: '2026-06-25T19:30:02.000Z',
} as const;

const ambiguousAgentEventDto: TriggerEventDetailResponseDto = {
  ...routedEventDto,
  id: '19191919-1919-4919-8919-191919191919',
  event_ref: 'slack:delivery-186:app_mention',
  provider: 'slack',
  source: 'slack',
  event: 'app_mention',
  delivery_id: 'delivery-186',
  matched_count: 0,
  payload: {event: {type: 'app_mention', channel: 'C04PAYMENTS', text: 'Why did the refund fail?'}},
  decisions: [
    {
      ...agentDecisionBase,
      id: '20202020-2020-4020-8020-202020202020',
      subscription_id: '21212121-2121-4121-8121-212121212121',
      subscription_name: 'payments',
      decision: 'owner',
    },
    {
      ...agentDecisionBase,
      id: '22222222-2222-4222-8222-222222222223',
      subscription_id: '23232323-2323-4323-8323-232323232323',
      subscription_name: 'shippy',
      decision: 'ambiguous',
    },
  ],
};

const droppedFollowUpEventDto: TriggerEventDetailResponseDto = {
  ...ambiguousAgentEventDto,
  id: '24242424-2424-4424-8424-242424242424',
  event_ref: 'slack:delivery-187:message',
  event: 'message',
  delivery_id: 'delivery-187',
  outcome: 'discarded',
  payload: {event: {type: 'message', channel: 'C04PAYMENTS', thread_ts: '1730000000.000100'}},
  decisions: [
    {
      ...agentDecisionBase,
      id: '25252525-2525-4525-8525-252525252525',
      received_event_id: '24242424-2424-4424-8424-242424242424',
      subscription_id: null,
      subscription_name: 'none',
      project_id: null,
      decision: 'dropped',
      reason: 'no-owner',
    },
  ],
};

const routedEvent = toTriggerEventDetail(routedEventDto);
const ambiguousAgentEvent = toTriggerEventDetail(ambiguousAgentEventDto);
const droppedFollowUpEvent = toTriggerEventDetail(droppedFollowUpEventDto);
const discardedEvent = toTriggerEventDetail(discardedEventDto);
const failedFilterEvent = toTriggerEventDetail(failedFilterEventDto);
const groupedErrorsEvent = toTriggerEventDetail(groupedErrorsEventDto);
const partialFailureEvent = toTriggerEventDetail(partialFailureEventDto);
const unavailableDetailsEvent = toTriggerEventDetail(unavailableDetailsEventDto);
const scrollingEvent = toTriggerEventDetail(scrollingEventDto);

const meta = {
  title: 'Triggers/EventDetail',
  component: TriggerEventDetailView,
  parameters: {
    layout: 'fullscreen',
    argos: {
      modes: {
        light: {theme: 'light'},
        dark: {theme: 'dark'},
      },
    },
  },
  decorators: [withRouter],
  args: {
    workspaceId: WORKSPACE_ID,
    workspaceSlug: 'acme',
    event: routedEvent,
    onBack: () => undefined,
  },
} satisfies Meta<typeof TriggerEventDetailView>;

export default meta;
type Story = StoryObj<typeof meta>;

async function captureDetail(ctx: Parameters<NonNullable<Story['play']>>[0], name: string) {
  await screen.findByRole('complementary', {name: 'Event details'});
  await argosScreenshot(ctx, name);
}

export const Playground: Story = {
  play: async (ctx) => {
    await captureDetail(ctx, 'Trigger Event Detail Playground');
  },
};

export const Discarded: Story = {
  args: {event: discardedEvent},
  play: async (ctx) => {
    await captureDetail(ctx, 'Trigger Event Detail Discarded');
  },
};

export const FailedFilter: Story = {
  args: {event: failedFilterEvent},
  play: async (ctx) => {
    await captureDetail(ctx, 'Trigger Event Detail Failed Filter');
  },
};

export const GroupedErrors: Story = {
  args: {event: groupedErrorsEvent},
  play: async (ctx) => {
    await captureDetail(ctx, 'Trigger Event Detail Grouped Errors');
  },
};

export const PartialFailure: Story = {
  args: {event: partialFailureEvent},
  play: async (ctx) => {
    await captureDetail(ctx, 'Trigger Event Detail Partial Failure');
  },
};

export const UnavailableDetails: Story = {
  args: {event: unavailableDetailsEvent},
  play: async (ctx) => {
    await captureDetail(ctx, 'Trigger Event Detail Unavailable Details');
  },
};

export const AmbiguousAgent: Story = {
  args: {event: ambiguousAgentEvent},
  play: async (ctx) => {
    await captureDetail(ctx, 'Trigger Event Detail Ambiguous Agent');
  },
};

export const DroppedFollowUp: Story = {
  args: {event: droppedFollowUpEvent},
  play: async (ctx) => {
    await captureDetail(ctx, 'Trigger Event Detail Dropped Follow-up');
  },
};

export const TestScrollable: Story = {
  args: {event: scrollingEvent},
  play: async () => {
    const detail = await screen.findByRole('complementary', {name: 'Event details'});
    const scrollport = detail.children.item(1);
    expect(scrollport).toBeInstanceOf(HTMLElement);
    if (!(scrollport instanceof HTMLElement)) return;

    expect(scrollport.scrollHeight).toBeGreaterThan(scrollport.clientHeight);
    scrollport.scrollTop = scrollport.scrollHeight;
    expect(scrollport.scrollTop).toBeGreaterThan(0);
  },
};
