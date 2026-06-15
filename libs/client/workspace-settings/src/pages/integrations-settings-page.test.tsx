import {configureApiClient} from '@shipfox/client-api';
import {screen} from '@testing-library/react';
import {
  jsonResponse,
  renderWorkspaceSettingsPage,
  WORKSPACE_SETTINGS_TEST_WID,
} from '#test/pages.js';
import {IntegrationsSettingsPage} from './integrations-settings-page.js';

const providers = {
  providers: [
    {provider: 'sentry', display_name: 'Sentry', capabilities: []},
    {provider: 'github', display_name: 'GitHub', capabilities: ['source_control']},
  ],
};

const githubConnection = {
  id: '44444444-4444-4444-8444-444444444444',
  workspace_id: WORKSPACE_SETTINGS_TEST_WID,
  provider: 'github',
  external_account_id: 'installation-1',
  display_name: 'acme-corp',
  lifecycle_status: 'active',
  capabilities: ['source_control'],
  external_url: 'https://github.com/organizations/acme-corp/settings/installations/1',
  created_at: '2026-03-12T00:00:00.000Z',
  updated_at: '2026-03-12T00:00:00.000Z',
};

function fetchForIntegrations({
  connectionsFail = false,
  connections = [githubConnection] as unknown[],
} = {}) {
  return vi.fn((input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.includes('/integration-providers')) {
      return Promise.resolve(jsonResponse(providers));
    }
    if (url.includes('/integration-connections')) {
      if (connectionsFail) {
        return Promise.resolve(jsonResponse({code: 'server-error'}, {status: 500}));
      }
      return Promise.resolve(jsonResponse({connections}));
    }
    return Promise.resolve(jsonResponse({}, {status: 404}));
  });
}

function renderPage() {
  return renderWorkspaceSettingsPage(
    `/workspaces/${WORKSPACE_SETTINGS_TEST_WID}/settings/integrations`,
    <IntegrationsSettingsPage />,
  );
}

const INTEGRATIONS_LINK_RE = /Integrations/;
const ADDED_METADATA_RE = /acme-corp · Added/;
const OPEN_IN_GITHUB_RE = /Open in GitHub/;
const PROVIDER_NAMES_RE = /GitHub|Sentry/;

describe('IntegrationsSettingsPage', () => {
  test('renders the settings shell with connected providers first', async () => {
    configureApiClient({
      baseUrl: 'https://api.example.test',
      fetchImpl: fetchForIntegrations(),
    });

    renderPage();

    expect(await screen.findByRole('heading', {name: 'Workspace settings'})).toBeVisible();
    expect(screen.getByRole('link', {name: INTEGRATIONS_LINK_RE})).toBeVisible();
    expect(await screen.findByText('Connected')).toBeVisible();
    expect(screen.getByText(ADDED_METADATA_RE)).toBeVisible();
    expect(screen.getByRole('link', {name: OPEN_IN_GITHUB_RE})).toHaveAttribute(
      'href',
      'https://github.com/organizations/acme-corp/settings/installations/1',
    );
    const cardTitles = screen.getAllByText(PROVIDER_NAMES_RE).map((element) => element.textContent);
    expect(cardTitles.indexOf('GitHub')).toBeLessThan(cardTitles.indexOf('Sentry'));
  });

  test('renders the disabled and error lifecycle pills', async () => {
    configureApiClient({
      baseUrl: 'https://api.example.test',
      fetchImpl: fetchForIntegrations({
        connections: [
          {...githubConnection, lifecycle_status: 'disabled'},
          {
            ...githubConnection,
            id: '55555555-5555-4555-8555-555555555555',
            provider: 'sentry',
            display_name: 'acme',
            lifecycle_status: 'error',
            external_url: undefined,
          },
        ],
      }),
    });

    renderPage();

    expect(await screen.findByText('Disabled')).toBeVisible();
    expect(screen.getByText('Error')).toBeVisible();
    expect(screen.queryByText('Connected')).not.toBeInTheDocument();
  });

  test('degrades to status-less cards when the connections request fails', async () => {
    configureApiClient({
      baseUrl: 'https://api.example.test',
      fetchImpl: fetchForIntegrations({connectionsFail: true}),
    });

    renderPage();

    expect(await screen.findByText('Could not load connection status')).toBeInTheDocument();
    expect(await screen.findByText('Sentry')).toBeVisible();
    expect(screen.queryByText('Connected')).not.toBeInTheDocument();
    expect(screen.getAllByRole('link', {name: 'Connect'}).length).toBeGreaterThan(0);
  });
});
