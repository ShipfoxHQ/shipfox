// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import {configureApiClient} from '@shipfox/client-api';
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {fireEvent, render, screen, waitFor} from '@testing-library/react';
import {ClaapConnectModal} from './claap-connect-modal.js';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const CONNECTION_ID = '22222222-2222-4222-8222-222222222222';

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {'content-type': 'application/json'},
    ...init,
  });
}

function renderModal(
  fetchImpl: typeof fetch,
  props?: Partial<Parameters<typeof ClaapConnectModal>[0]>,
) {
  configureApiClient({baseUrl: 'https://api.example.test', fetchImpl});
  const queryClient = new QueryClient({
    defaultOptions: {queries: {retry: false}, mutations: {retry: false}},
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <ClaapConnectModal
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
  provider: 'claap',
  external_account_id: 'q2IqD9wUHb',
  slug: 'claap_mercateam',
  display_name: 'Claap Mercateam',
  lifecycle_status: 'active',
  capabilities: [],
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
};

describe('ClaapConnectModal', () => {
  test('sends the trimmed key and reports the new connection', async () => {
    const requests: Request[] = [];
    const onConnected = vi.fn();
    renderModal(
      vi.fn((input, init) => {
        requests.push(new Request(input, init));
        return Promise.resolve(jsonResponse({connection}));
      }),
      {onConnected},
    );

    fireEvent.change(screen.getByLabelText('API key'), {target: {value: ' cla_secret '}});
    fireEvent.click(screen.getByRole('button', {name: 'Connect'}));

    await waitFor(() => expect(onConnected).toHaveBeenCalled());
    expect(onConnected.mock.calls[0]?.[0]).toMatchObject({
      id: CONNECTION_ID,
      slug: 'claap_mercateam',
    });
    expect(requests[0]?.url).toBe('https://api.example.test/integrations/claap/connect');
    expect(await requests[0]?.json()).toEqual({workspace_id: WORKSPACE_ID, api_key: 'cla_secret'});
  });

  test('shows the already-connected recovery action and passes its connection id', async () => {
    const onOpenReplaceApiKey = vi.fn();
    renderModal(
      vi.fn(() =>
        Promise.resolve(
          jsonResponse(
            {code: 'already-connected', details: {connection_id: CONNECTION_ID}},
            {status: 409},
          ),
        ),
      ),
      {onOpenReplaceApiKey},
    );

    fireEvent.change(screen.getByLabelText('API key'), {target: {value: 'cla_secret'}});
    fireEvent.click(screen.getByRole('button', {name: 'Connect'}));

    expect(await screen.findByText('This Claap workspace is already connected')).toBeVisible();
    fireEvent.click(screen.getByRole('button', {name: 'Replace API key'}));
    expect(onOpenReplaceApiKey).toHaveBeenCalledWith(CONNECTION_ID);
  });

  test('shows a rejected key on the key field', async () => {
    renderModal(
      vi.fn(() =>
        Promise.resolve(jsonResponse({code: 'invalid-api-key', details: {}}, {status: 400})),
      ),
    );

    fireEvent.change(screen.getByLabelText('API key'), {target: {value: 'cla_revoked'}});
    fireEvent.click(screen.getByRole('button', {name: 'Connect'}));

    expect(
      await screen.findByText(
        'Claap did not accept this key. Check that it is active and copied in full.',
      ),
    ).toBeVisible();
    expect(screen.getByLabelText('API key')).toHaveAttribute('aria-invalid', 'true');
  });
});
