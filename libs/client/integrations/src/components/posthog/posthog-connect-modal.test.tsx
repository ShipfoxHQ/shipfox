// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import {configureApiClient} from '@shipfox/client-api';
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {fireEvent, render, screen, waitFor} from '@testing-library/react';
import {useState} from 'react';
import {PosthogConnectModal} from './posthog-connect-modal.js';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const CONNECTION_ID = '22222222-2222-4222-8222-222222222222';
const ANALYTICS_PROJECT_RE = /Analytics/u;

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(body === undefined ? undefined : JSON.stringify(body), {
    status: 200,
    headers: {'content-type': 'application/json'},
    ...init,
  });
}

function renderModal(
  fetchImpl: typeof fetch,
  props?: Partial<Parameters<typeof PosthogConnectModal>[0]>,
) {
  configureApiClient({baseUrl: 'https://api.example.test', fetchImpl});
  const queryClient = new QueryClient({
    defaultOptions: {queries: {retry: false}, mutations: {retry: false}},
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <PosthogConnectModal
        workspaceId={WORKSPACE_ID}
        open
        onOpenChange={() => undefined}
        {...props}
      />
    </QueryClientProvider>,
  );
}

const connection = {
  id: CONNECTION_ID,
  workspace_id: WORKSPACE_ID,
  provider: 'posthog',
  external_account_id: 'eu:project-1',
  slug: 'posthog_analytics',
  display_name: 'Analytics',
  lifecycle_status: 'active',
  capabilities: ['agent_tools'],
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
};

describe('PosthogConnectModal', () => {
  test('moves from the key form to a project picker and resubmits the key', async () => {
    const requests: Request[] = [];
    const fetchImpl = vi.fn((input, init) => {
      const request = new Request(input, init);
      requests.push(request);
      return Promise.resolve(
        jsonResponse(
          requests.length === 1
            ? {status: 'select-project', projects: [{id: 'project-1', name: 'Analytics'}]}
            : {status: 'connected', connection},
        ),
      );
    });
    renderModal(fetchImpl);

    fireEvent.change(screen.getByLabelText('Personal API key'), {
      target: {value: 'phx_secret'},
    });
    fireEvent.click(screen.getByRole('button', {name: 'Connect'}));

    expect(await screen.findByText('Choose a PostHog project')).toBeVisible();
    fireEvent.click(screen.getByRole('radio', {name: ANALYTICS_PROJECT_RE}));

    await waitFor(() => expect(requests).toHaveLength(2));
    expect(await requests[1]?.json()).toEqual({
      workspace_id: WORKSPACE_ID,
      region: 'eu',
      api_key: 'phx_secret',
      project_id: 'project-1',
    });
  });

  test('shows the already-connected recovery action and passes its connection id', async () => {
    const onOpenReplaceApiKey = vi.fn();
    const fetchImpl = vi.fn(() =>
      Promise.resolve(
        jsonResponse(
          {status: 'already-connected', connection_id: CONNECTION_ID, code: 'already-connected'},
          {status: 409, statusText: 'Conflict'},
        ),
      ),
    );
    renderModal(fetchImpl, {onOpenReplaceApiKey});

    fireEvent.change(screen.getByLabelText('Personal API key'), {
      target: {value: 'phx_secret'},
    });
    fireEvent.click(screen.getByRole('button', {name: 'Connect'}));

    expect(await screen.findByText('This project is already connected')).toBeVisible();
    fireEvent.click(screen.getByRole('button', {name: 'Replace API key'}));
    expect(onOpenReplaceApiKey).toHaveBeenCalledWith(CONNECTION_ID);
  });

  test('clears the key when the modal closes', async () => {
    function ControlledModal() {
      const [open, setOpen] = useState(true);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            Reopen
          </button>
          <PosthogConnectModal workspaceId={WORKSPACE_ID} open={open} onOpenChange={setOpen} />
        </>
      );
    }

    const {unmount} = render(
      <QueryClientProvider client={new QueryClient()}>
        <ControlledModal />
      </QueryClientProvider>,
    );
    fireEvent.change(screen.getByLabelText('Personal API key'), {
      target: {value: 'phx_secret'},
    });
    fireEvent.click(screen.getByRole('button', {name: 'Cancel'}));
    await waitFor(() =>
      expect(screen.queryByLabelText('Personal API key')).not.toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole('button', {name: 'Reopen'}));
    expect(await screen.findByLabelText('Personal API key')).toHaveValue('');
    unmount();
  });
});
