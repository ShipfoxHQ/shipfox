// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import type {IntegrationConnectionDto} from '@shipfox/api-integration-core-dto';
import {configureApiClient} from '@shipfox/client-api';
import {screen} from '@testing-library/react';
import {INTEGRATIONS_TEST_WID, jsonResponse, renderIntegrationsPage} from '#test/render.js';
import {ConnectionDetailsPage} from './connection-details-page.js';

const CONNECTION_ID = '44444444-4444-4444-8444-444444444444';

const githubConnection = {
  id: CONNECTION_ID,
  workspace_id: INTEGRATIONS_TEST_WID,
  provider: 'github',
  external_account_id: 'installation-1',
  slug: 'github_acme_corp',
  display_name: 'acme-corp',
  lifecycle_status: 'active',
  capabilities: ['source_control'],
  external_url: 'https://github.com/organizations/acme-corp/settings/installations/1',
  created_at: '2026-03-12T00:00:00.000Z',
  updated_at: '2026-03-12T00:00:00.000Z',
} satisfies IntegrationConnectionDto;

const slackConnection = {
  ...githubConnection,
  provider: 'slack',
  external_account_id: 'T1',
  slug: 'slack_acme',
  display_name: 'Slack Acme',
  capabilities: ['agent_tools'],
} satisfies IntegrationConnectionDto;

function renderDetails(connection: IntegrationConnectionDto) {
  configureApiClient({
    baseUrl: 'https://api.example.test',
    fetchImpl: vi.fn(() => Promise.resolve(jsonResponse({connections: [connection]}))),
  });
  return renderIntegrationsPage({
    path: `/w/acme/settings/integrations/${connection.slug}`,
    routePath: '/w/$workspaceSlug/settings/integrations/$connectionSlug',
    element: <ConnectionDetailsPage workspaceSlug="acme" connectionSlug={connection.slug} />,
    extraRoutes: [
      '/w/$workspaceSlug/settings/integrations',
      '/w/$workspaceSlug/integrations/slack',
    ],
  });
}

describe('ConnectionDetailsPage', () => {
  test('asks a connection missing new permissions to reconnect', async () => {
    renderDetails({...slackConnection, reconnect_required: true});

    expect(await screen.findByText('New permissions needed')).toBeVisible();
    expect(screen.getByRole('link', {name: 'Reconnect Slack'})).toHaveAttribute(
      'href',
      '/w/acme/integrations/slack',
    );
    expect(screen.queryByText('No settings to change')).not.toBeInTheDocument();
  });

  test('shows no reconnect notice for an up-to-date connection', async () => {
    renderDetails(slackConnection);

    expect(await screen.findByText('No settings to change')).toBeVisible();
    expect(screen.queryByText('New permissions needed')).not.toBeInTheDocument();
  });
});
