import {configureApiClient} from '@shipfox/client-api';
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {act, render, screen, waitFor, within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type {ReactElement} from 'react';
import {agentCredentialQueryKeys} from '#hooks/api/agent-access/credentials.js';
import {AgentAccessSettingsPage} from './agent-access-settings-page.js';
import {formatAgentAccessDate, formatAgentAccessTimestamp} from './format.js';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_WORKSPACE_ID = '22222222-2222-4222-8222-222222222222';
const GRANT_ID = '33333333-3333-4333-8333-333333333333';
const REVOCATION_WINDOW_COPY = /continue for up to 15 minutes/;
const APP_NOT_SORTED = /App, not sorted/u;
const ACCESS_REFRESHED_NOT_SORTED = /Access refreshed, not sorted/u;

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status: 200,
    headers: {'content-type': 'application/json'},
    ...init,
  });
}

function renderSettings(element: ReactElement) {
  const queryClient = new QueryClient({defaultOptions: {queries: {retry: false}}});
  return {
    queryClient,
    ...render(<QueryClientProvider client={queryClient}>{element}</QueryClientProvider>),
  };
}

describe('AgentAccessSettingsPage', () => {
  test('guides setup and copies the selected client commands before any app is connected', async () => {
    const user = userEvent.setup();
    configureApiClient({
      baseUrl: 'https://api.example.test/proxy/',
      fetchImpl: vi.fn().mockResolvedValue(jsonResponse({grants: []})),
    });
    renderSettings(<AgentAccessSettingsPage workspaceId={WORKSPACE_ID} />);

    expect(await screen.findByText('No connected apps')).toBeVisible();
    expect(screen.getByText('Shipfox MCP server endpoint')).toBeVisible();
    expect(screen.getByText('https://api.example.test/proxy/mcp')).toBeVisible();
    await user.click(screen.getByRole('tab', {name: 'Codex'}));
    const instructions = screen.getByRole('tabpanel');
    await user.click(within(instructions).getByRole('button', {name: 'Copy Codex commands'}));

    expect(await navigator.clipboard.readText()).toBe(
      "codex mcp add shipfox --url 'https://api.example.test/proxy/mcp'\ncodex mcp login shipfox",
    );
    expect(within(instructions).queryByText('Claude Code command')).not.toBeInTheDocument();
  });

  test('shows only OAuth apps authorized for the active workspace', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        grants: [
          grantDto({client_name: 'Claude Desktop'}),
          grantDto({
            id: OTHER_WORKSPACE_ID,
            workspace_id: OTHER_WORKSPACE_ID,
            client_name: 'Hidden',
          }),
        ],
      }),
    );
    configureApiClient({baseUrl: 'https://api.example.test', fetchImpl});

    renderSettings(<AgentAccessSettingsPage workspaceId={WORKSPACE_ID} />);

    expect(await screen.findByText('Claude Desktop')).toBeVisible();
    expect(screen.queryByText('Hidden')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', {name: 'Connected apps'})).toBeVisible();
    expect(
      await screen.findByText('Read workspace data and start or manage workflow runs.'),
    ).toBeVisible();
  });

  test('sorts every loaded grant after filtering to the active workspace', async () => {
    const user = userEvent.setup();
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        grants: [
          grantDto({
            id: '44444444-4444-4444-8444-444444444444',
            client_name: 'Zulu Desktop',
            created_at: '2026-09-03T10:00:00.000Z',
            last_refreshed_at: '2026-09-03T10:00:00.000Z',
          }),
          grantDto({
            id: '55555555-5555-4555-8555-555555555555',
            client_name: 'Alpha Desktop',
            created_at: '2026-09-01T10:00:00.000Z',
            last_refreshed_at: '2026-09-02T10:00:00.000Z',
          }),
          grantDto({
            id: '66666666-6666-4666-8666-666666666666',
            client_name: 'Mike Desktop',
            created_at: '2026-09-02T10:00:00.000Z',
            last_refreshed_at: '2026-09-04T10:00:00.000Z',
          }),
          grantDto({
            id: '77777777-7777-4777-8777-777777777777',
            client_name: 'Hidden Desktop',
            workspace_id: OTHER_WORKSPACE_ID,
          }),
        ],
      }),
    );
    configureApiClient({baseUrl: 'https://api.example.test', fetchImpl});
    renderSettings(<AgentAccessSettingsPage workspaceId={WORKSPACE_ID} />);

    await screen.findByText('Zulu Desktop');
    expect(screen.queryByText('Hidden Desktop')).not.toBeInTheDocument();
    expect(document.querySelectorAll('[data-row-id]')).toHaveLength(3);

    const rowNames = () =>
      Array.from(document.querySelectorAll<HTMLElement>('[data-row-id]')).map((row) => {
        if (row.textContent?.includes('Alpha Desktop')) return 'Alpha Desktop';
        if (row.textContent?.includes('Mike Desktop')) return 'Mike Desktop';
        if (row.textContent?.includes('Zulu Desktop')) return 'Zulu Desktop';
        return 'unknown';
      });

    await user.click(screen.getByRole('button', {name: APP_NOT_SORTED}));
    await waitFor(() =>
      expect(rowNames()).toEqual(['Alpha Desktop', 'Mike Desktop', 'Zulu Desktop']),
    );

    await user.click(screen.getByRole('button', {name: ACCESS_REFRESHED_NOT_SORTED}));
    await waitFor(() =>
      expect(rowNames()).toEqual(['Alpha Desktop', 'Zulu Desktop', 'Mike Desktop']),
    );
  });

  test('keeps the table header and columns visible while grants load', () => {
    configureApiClient({
      baseUrl: 'https://api.example.test',
      fetchImpl: vi.fn().mockReturnValue(new Promise<Response>(() => undefined)),
    });
    renderSettings(<AgentAccessSettingsPage workspaceId={WORKSPACE_ID} />);

    expect(screen.getByRole('table')).toHaveAttribute('aria-busy', 'true');
    expect(screen.getAllByRole('columnheader')).toHaveLength(4);
    expect(screen.getByText('Loading connected apps')).toBeInTheDocument();
  });

  test('keeps loaded rows visible and marks the table busy during a grants refetch', async () => {
    let resolveRefresh!: (response: Response) => void;
    const refreshResponse = new Promise<Response>((resolve) => {
      resolveRefresh = resolve;
    });
    let requestCount = 0;
    const fetchImpl = vi.fn(() => {
      requestCount += 1;
      return requestCount === 1
        ? Promise.resolve(jsonResponse({grants: [grantDto()]}))
        : refreshResponse;
    });
    configureApiClient({baseUrl: 'https://api.example.test', fetchImpl});
    const {queryClient} = renderSettings(<AgentAccessSettingsPage workspaceId={WORKSPACE_ID} />);

    expect(await screen.findByText('Claude Desktop')).toBeVisible();

    const refetch = queryClient.refetchQueries({queryKey: agentCredentialQueryKeys.grants()});
    await waitFor(() => {
      expect(screen.getByRole('table')).toHaveAttribute('aria-busy', 'true');
      expect(screen.getByText('Claude Desktop')).toBeVisible();
    });

    await act(async () => {
      resolveRefresh(jsonResponse({grants: [grantDto()]}));
      await refetch;
    });

    await waitFor(() => expect(screen.getByRole('table')).not.toHaveAttribute('aria-busy'));
    expect(screen.getByText('Claude Desktop')).toBeVisible();
  });

  test('confirms OAuth revocation with its actual propagation window', async () => {
    const user = userEvent.setup();
    let hasGrant = true;
    const fetchImpl = vi.fn((input: RequestInfo | URL) => {
      const request = input as Request;
      if (request.url.endsWith(`/grants/${GRANT_ID}`) && request.method === 'DELETE') {
        hasGrant = false;
        return Promise.resolve(new Response(null, {status: 204}));
      }
      return Promise.resolve(jsonResponse({grants: hasGrant ? [grantDto()] : []}));
    });
    configureApiClient({baseUrl: 'https://api.example.test', fetchImpl});
    renderSettings(<AgentAccessSettingsPage workspaceId={WORKSPACE_ID} />);

    expect(await screen.findByText('Claude Desktop')).toBeVisible();
    const revokeButton = screen.getByRole('button', {name: 'Disconnect Claude Desktop'});
    await user.click(revokeButton);
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('heading', {name: 'Disconnect Claude Desktop?'})).toBeVisible();
    expect(within(dialog).getByText(REVOCATION_WINDOW_COPY)).toBeVisible();
    await user.click(within(dialog).getByRole('button', {name: 'Disconnect app'}));

    await waitFor(() => expect(screen.getByText('No connected apps')).toBeVisible());
  });

  test('reveals exact app identity and timestamps to keyboard users', async () => {
    const user = userEvent.setup();
    const clientName = `Claude Desktop ${'connection-name-'.repeat(10)}`;
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        grants: [grantDto({client_name: clientName})],
      }),
    );
    configureApiClient({baseUrl: 'https://api.example.test', fetchImpl});
    renderSettings(<AgentAccessSettingsPage workspaceId={WORKSPACE_ID} />);

    expect(await screen.findByText(clientName)).toBeVisible();
    const connectedDate = screen.getByText(formatAgentAccessDate('2026-09-01T10:00:00.000Z'));
    const timestampTrigger = connectedDate.closest('button');
    if (!timestampTrigger) throw new Error('Connected timestamp trigger not rendered');
    act(() => timestampTrigger.focus());
    expect(await screen.findByRole('tooltip')).toHaveTextContent(
      formatAgentAccessTimestamp('2026-09-01T10:00:00.000Z') ?? '',
    );

    const revokeButton = screen.getByRole('button', {name: `Disconnect ${clientName}`});
    await user.click(revokeButton);

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(clientName)).toBeVisible();
  });

  test('keeps the disconnect dialog retryable when revocation fails', async () => {
    const user = userEvent.setup();
    let deleteCount = 0;
    let hasGrant = true;
    const fetchImpl = vi.fn((input: RequestInfo | URL) => {
      const request = input as Request;
      if (request.url.endsWith(`/grants/${GRANT_ID}`) && request.method === 'DELETE') {
        deleteCount += 1;
        if (deleteCount === 1) {
          return Promise.resolve(
            jsonResponse(
              {code: 'auth-dependency-unavailable', message: 'Temporarily unavailable'},
              {status: 503},
            ),
          );
        }
        hasGrant = false;
        return Promise.resolve(new Response(null, {status: 204}));
      }
      return Promise.resolve(jsonResponse({grants: hasGrant ? [grantDto()] : []}));
    });
    configureApiClient({baseUrl: 'https://api.example.test', fetchImpl});
    renderSettings(<AgentAccessSettingsPage workspaceId={WORKSPACE_ID} />);

    expect(await screen.findByText('Claude Desktop')).toBeVisible();
    const revokeButton = screen.getByRole('button', {name: 'Disconnect Claude Desktop'});
    await user.click(revokeButton);
    const dialog = await screen.findByRole('dialog');
    const confirmButton = within(dialog).getByRole('button', {name: 'Disconnect app'});
    await user.click(confirmButton);

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'The Shipfox MCP server is temporarily unavailable. Try again in a moment.',
    );
    expect(dialog).toBeVisible();
    expect(confirmButton).toBeEnabled();

    await user.click(confirmButton);

    await waitFor(() => expect(deleteCount).toBe(2));
    expect(screen.getByText('No connected apps')).toBeVisible();
    expect(dialog).not.toBeInTheDocument();
  }, 10_000);
});

function grantDto(overrides: Record<string, unknown> = {}) {
  return {
    id: GRANT_ID,
    client_name: 'Claude Desktop',
    workspace_id: WORKSPACE_ID,
    created_at: '2026-09-01T10:00:00.000Z',
    last_refreshed_at: '2026-09-02T10:00:00.000Z',
    ...overrides,
  };
}
