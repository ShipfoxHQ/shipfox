// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import {configureApiClient} from '@shipfox/client-api';
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {fireEvent, render, screen, waitFor, within} from '@testing-library/react';
import type {IntegrationConnection} from '#core/models.js';
import {PosthogConnectionSettings} from './connection-details-page.js';

const connection: IntegrationConnection = {
  id: '22222222-2222-4222-8222-222222222222',
  workspaceId: '11111111-1111-4111-8111-111111111111',
  provider: 'posthog',
  externalAccountId: 'eu:project-1',
  slug: 'posthog_analytics',
  displayName: 'Analytics',
  lifecycleStatus: 'error',
  capabilities: ['agent_tools'],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

describe('PosthogConnectionSettings', () => {
  test('shows the error treatment and replaces the key on the connection', async () => {
    const requests: Request[] = [];
    configureApiClient({
      baseUrl: 'https://api.example.test',
      fetchImpl: vi.fn((input, init) => {
        requests.push(new Request(input, init));
        return Promise.resolve(new Response(undefined, {status: 204}));
      }),
    });
    render(
      <QueryClientProvider client={new QueryClient()}>
        <PosthogConnectionSettings connection={connection} workspaceId={connection.workspaceId} />
      </QueryClientProvider>,
    );

    expect(screen.getByRole('alert')).toHaveTextContent('PostHog could not authenticate');
    fireEvent.click(screen.getByRole('button', {name: 'Replace API key'}));
    fireEvent.change(screen.getByLabelText('New personal API key'), {
      target: {value: 'phx_replacement'},
    });
    fireEvent.click(
      within(screen.getByRole('dialog', {name: 'Replace PostHog API key'})).getByRole('button', {
        name: 'Replace API key',
      }),
    );

    await waitFor(() => expect(requests).toHaveLength(1));
    expect(requests[0]?.method).toBe('PUT');
    expect(requests[0]?.url).toContain(
      `/integrations/posthog/connections/${connection.id}/api-key`,
    );
    expect(await requests[0]?.json()).toEqual({api_key: 'phx_replacement'});
  });
});
