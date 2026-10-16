// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import {configureApiClient} from '@shipfox/client-api';
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {fireEvent, render, screen, waitFor, within} from '@testing-library/react';
import type {IntegrationConnection} from '#core/models.js';
import {JamConnectionSettings} from './jam-connection-settings.js';

const connection: IntegrationConnection = {
  id: '22222222-2222-4222-8222-222222222222',
  workspaceId: '11111111-1111-4111-8111-111111111111',
  provider: 'jam',
  externalAccountId: 'team-1',
  slug: 'jam',
  displayName: 'Jam',
  lifecycleStatus: 'error',
  capabilities: ['agent_tools'],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {'content-type': 'application/json'},
  });
}

describe('JamConnectionSettings', () => {
  test('names the Jam user, shows the error, and replaces the token', async () => {
    const requests: Request[] = [];
    configureApiClient({
      baseUrl: 'https://api.example.test',
      fetchImpl: vi.fn((input, init) => {
        const request = new Request(input, init);
        requests.push(request);
        if (request.method === 'GET') {
          return Promise.resolve(
            jsonResponse({user_name: 'Ada', user_email: 'ada@example.com', token_hint: 'k9Qz'}),
          );
        }
        return Promise.resolve(
          jsonResponse({
            id: connection.id,
            workspace_id: connection.workspaceId,
            provider: 'jam',
            external_account_id: 'team-1',
            slug: 'jam',
            display_name: 'Jam',
            lifecycle_status: 'active',
            capabilities: [],
            created_at: connection.createdAt,
            updated_at: connection.updatedAt,
          }),
        );
      }),
    });
    render(
      <QueryClientProvider client={new QueryClient({defaultOptions: {queries: {retry: false}}})}>
        <JamConnectionSettings connection={connection} workspaceId={connection.workspaceId} />
      </QueryClientProvider>,
    );

    expect(screen.getByRole('alert')).toHaveTextContent('Jam rejected the token');
    expect(await screen.findByText('Ada')).toBeVisible();
    expect(screen.getByText('Token ending in k9Qz.')).toBeVisible();

    fireEvent.click(screen.getByRole('button', {name: 'Replace token'}));
    fireEvent.change(screen.getByLabelText('New personal access token'), {
      target: {value: 'jam_pat_replacement'},
    });
    fireEvent.click(
      within(screen.getByRole('dialog', {name: 'Replace Jam token'})).getByRole('button', {
        name: 'Replace token',
      }),
    );

    await waitFor(() => expect(requests.some((request) => request.method === 'PUT')).toBe(true));
    const put = requests.find((request) => request.method === 'PUT');
    expect(put?.url).toContain(`/integrations/jam/connections/${connection.id}/token`);
    expect(await put?.json()).toEqual({token: 'jam_pat_replacement'});
  });
});
