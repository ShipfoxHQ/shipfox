import type {TriggerEventDetailResponseDto} from '@shipfox/api-triggers-dto';
import {RelativeTimeProvider} from '@shipfox/react-ui';
import {render, screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type {AnchorHTMLAttributes, ReactElement, ReactNode} from 'react';
import {useTriggerEventQuery} from '#hooks/api/trigger-events.js';
import {TriggerEventDetail, TriggerEventDetailView} from './trigger-event-detail.js';

vi.mock('#hooks/api/trigger-events.js', () => ({
  useTriggerEventQuery: vi.fn(),
}));

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    to,
    params,
    search: _search,
    children,
    ...props
  }: AnchorHTMLAttributes<HTMLAnchorElement> & {
    to: string;
    params?: Record<string, string> | undefined;
    search?: unknown;
    children: ReactNode;
  }) => {
    const href = Object.entries(params ?? {}).reduce(
      (path, [key, value]) => path.replace(`$${key}`, value),
      to,
    );
    return (
      <a href={href} {...props}>
        {children}
      </a>
    );
  },
}));

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const PROJECT_ID = '22222222-2222-4222-8222-222222222222';
const RUN_ID = '33333333-3333-4333-8333-333333333333';
const EVENT_ID = '44444444-4444-4444-8444-444444444444';
const DEPLOY_RUN_LINK_NAME = /deploy-web #184/u;
const PAYLOAD_REF_LINE = /"ref": "refs\/heads\/main"/u;

const useTriggerEventQueryMock = vi.mocked(useTriggerEventQuery);

function makeEvent(
  overrides: Partial<TriggerEventDetailResponseDto> = {},
): TriggerEventDetailResponseDto {
  return {
    id: EVENT_ID,
    event_ref: 'github:delivery-179:push',
    origin: 'integration',
    workspace_id: WORKSPACE_ID,
    source: 'github',
    event: 'push',
    delivery_id: 'delivery-179',
    connection_id: '55555555-5555-4555-8555-555555555555',
    connection_name: 'ShipfoxHQ Production',
    outcome: 'routed',
    matched_count: 1,
    payload: {ref: 'refs/heads/main', action: 'push'},
    received_at: '2026-06-25T19:30:00.000Z',
    processed_at: '2026-06-25T19:30:02.000Z',
    created_at: '2026-06-25T19:30:00.000Z',
    decisions: [
      {
        id: '66666666-6666-4666-8666-666666666666',
        received_event_id: EVENT_ID,
        subscription_id: '77777777-7777-4777-8777-777777777777',
        subscription_name: 'Deploy production',
        workflow_definition_id: '88888888-8888-4888-8888-888888888888',
        project_id: PROJECT_ID,
        decision: 'triggered',
        run_id: RUN_ID,
        run_name: 'deploy-web #184',
        reason: null,
        created_at: '2026-06-25T19:30:02.000Z',
      },
    ],
    ...overrides,
  };
}

function renderWithProviders(ui: ReactElement) {
  return render(<RelativeTimeProvider>{ui}</RelativeTimeProvider>);
}

function renderDetailView(event: TriggerEventDetailResponseDto, onBack = vi.fn()) {
  return renderWithProviders(
    <TriggerEventDetailView workspaceId={WORKSPACE_ID} event={event} onBack={onBack} />,
  );
}

describe('TriggerEventDetailView', () => {
  test('renders the result badge, run links, and payload', () => {
    renderDetailView(makeEvent());

    expect(screen.getByText('Triggered 1 workflow')).toBeInTheDocument();
    expect(screen.getByText('Deploy production')).toBeInTheDocument();
    expect(screen.getByRole('link', {name: DEPLOY_RUN_LINK_NAME})).toHaveAttribute(
      'href',
      `/workspaces/${WORKSPACE_ID}/projects/${PROJECT_ID}/runs/${RUN_ID}`,
    );
    expect(screen.getByText(PAYLOAD_REF_LINE)).toBeInTheDocument();
  });

  test('renders a no-subscriptions note for a discarded event', () => {
    renderDetailView(makeEvent({outcome: 'discarded', matched_count: 0, decisions: []}));

    expect(screen.getByText('No workflows triggered')).toBeInTheDocument();
    expect(screen.getByText('No workflows are subscribed to this event.')).toBeInTheDocument();
    expect(screen.queryByText('Matched workflows')).not.toBeInTheDocument();
  });

  test('renders errored decisions inline with their reason', () => {
    renderDetailView(
      makeEvent({
        outcome: 'errored',
        decisions: [
          {
            id: '66666666-6666-4666-8666-666666666666',
            received_event_id: EVENT_ID,
            subscription_id: '77777777-7777-4777-8777-777777777777',
            subscription_name: 'Deploy production',
            workflow_definition_id: '88888888-8888-4888-8888-888888888888',
            project_id: PROJECT_ID,
            decision: 'errored',
            run_id: null,
            run_name: null,
            reason: 'workflow definition deleted',
            created_at: '2026-06-25T19:30:02.000Z',
          },
        ],
      }),
    );

    expect(screen.getByText('Failed')).toBeInTheDocument();
    expect(screen.getByText('Deploy production')).toBeInTheDocument();
    expect(screen.getByText('workflow definition deleted')).toBeInTheDocument();
  });

  test('renders null run fields without a run link', () => {
    renderDetailView(
      makeEvent({
        decisions: [
          {
            id: '66666666-6666-4666-8666-666666666666',
            received_event_id: EVENT_ID,
            subscription_id: '77777777-7777-4777-8777-777777777777',
            subscription_name: 'Deploy production',
            workflow_definition_id: '88888888-8888-4888-8888-888888888888',
            project_id: PROJECT_ID,
            decision: 'errored',
            run_id: null,
            run_name: null,
            reason: null,
            created_at: '2026-06-25T19:30:02.000Z',
          },
        ],
      }),
    );

    expect(screen.getByText('No run created')).toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  test('calls onBack from the focused detail panel control', async () => {
    const onBack = vi.fn();
    renderDetailView(makeEvent(), onBack);

    await userEvent.click(screen.getByRole('button', {name: 'Back to events'}));

    expect(onBack).toHaveBeenCalledTimes(1);
  });
});

describe('TriggerEventDetail', () => {
  beforeEach(() => {
    useTriggerEventQueryMock.mockReset();
  });

  test('renders a loading panel while the detail query is pending', () => {
    useTriggerEventQueryMock.mockReturnValue({
      data: undefined,
      isError: false,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useTriggerEventQuery>);

    renderWithProviders(
      <TriggerEventDetail workspaceId={WORKSPACE_ID} eventId={EVENT_ID} onBack={vi.fn()} />,
    );

    expect(screen.getByRole('button', {name: 'Back to events'})).toBeInTheDocument();
  });

  test('renders a retry action when the detail query fails', async () => {
    const refetch = vi.fn();
    useTriggerEventQueryMock.mockReturnValue({
      data: undefined,
      isError: true,
      refetch,
    } as unknown as ReturnType<typeof useTriggerEventQuery>);

    renderWithProviders(
      <TriggerEventDetail workspaceId={WORKSPACE_ID} eventId={EVENT_ID} onBack={vi.fn()} />,
    );

    await userEvent.click(screen.getByRole('button', {name: 'Retry'}));

    expect(screen.getByText('Event detail could not be loaded.')).toBeInTheDocument();
    expect(refetch).toHaveBeenCalledTimes(1);
  });
});
