// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import {configureApiClient} from '@shipfox/client-api';
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {fireEvent, render, screen, waitFor} from '@testing-library/react';
import {JamConnectModal} from './jam-connect-modal.js';

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
  props?: Partial<Parameters<typeof JamConnectModal>[0]>,
) {
  configureApiClient({baseUrl: 'https://api.example.test', fetchImpl});
  const queryClient = new QueryClient({
    defaultOptions: {queries: {retry: false}, mutations: {retry: false}},
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <JamConnectModal workspaceId={WORKSPACE_ID} open onOpenChange={() => undefined} {...props} />
    </QueryClientProvider>,
  );
}

const connection = {
  id: CONNECTION_ID,
  workspace_id: WORKSPACE_ID,
  provider: 'jam',
  external_account_id: 'team-1',
  slug: 'jam',
  display_name: 'Jam',
  lifecycle_status: 'active',
  capabilities: [],
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
};

describe('JamConnectModal', () => {
  test('connects with the trimmed token and reports the new connection', async () => {
    const requests: Request[] = [];
    const onConnected = vi.fn();
    const onOpenChange = vi.fn();
    renderModal(
      vi.fn((input, init) => {
        requests.push(new Request(input, init));
        return Promise.resolve(jsonResponse({connection}));
      }),
      {onConnected, onOpenChange},
    );

    fireEvent.change(screen.getByLabelText('Personal access token'), {
      target: {value: ' jam_pat_secret '},
    });
    fireEvent.click(screen.getByRole('button', {name: 'Connect'}));

    await waitFor(() =>
      expect(onConnected).toHaveBeenCalledWith(expect.objectContaining({slug: 'jam'})),
    );
    expect(requests[0]?.url).toContain('/integrations/jam/connect');
    expect(await requests[0]?.json()).toEqual({
      workspace_id: WORKSPACE_ID,
      token: 'jam_pat_secret',
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  test('offers to replace the token of an already-connected Jam workspace', async () => {
    const onOpenReplaceToken = vi.fn();
    renderModal(
      vi.fn(() =>
        Promise.resolve(
          jsonResponse(
            {code: 'already-connected', details: {connection_id: CONNECTION_ID}},
            {status: 409},
          ),
        ),
      ),
      {onOpenReplaceToken},
    );

    fireEvent.change(screen.getByLabelText('Personal access token'), {
      target: {value: 'jam_pat_secret'},
    });
    fireEvent.click(screen.getByRole('button', {name: 'Connect'}));

    expect(await screen.findByText('This Jam workspace is already connected')).toBeVisible();
    fireEvent.click(screen.getByRole('button', {name: 'Replace token'}));
    expect(onOpenReplaceToken).toHaveBeenCalledWith(CONNECTION_ID);
  });

  test('shows a CLI-only token error on the token field', async () => {
    renderModal(
      vi.fn(() =>
        Promise.resolve(jsonResponse({code: 'missing-read-scope', details: {}}, {status: 400})),
      ),
    );

    fireEvent.change(screen.getByLabelText('Personal access token'), {
      target: {value: 'jam_pat_cli'},
    });
    fireEvent.click(screen.getByRole('button', {name: 'Connect'}));

    expect(
      await screen.findByText(
        'This token has no MCP access. Create a token with MCP read access, not CLI access only.',
      ),
    ).toBeVisible();
    expect(screen.getByLabelText('Personal access token')).toHaveAttribute('aria-invalid', 'true');
  });
});
