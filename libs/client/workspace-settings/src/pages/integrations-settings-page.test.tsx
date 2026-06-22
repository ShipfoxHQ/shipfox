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

function fetchForIntegrations({connections = [githubConnection] as unknown[]} = {}) {
  return vi.fn((input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.includes('/integration-providers')) {
      return Promise.resolve(jsonResponse(providers));
    }
    if (url.includes('/integration-connections')) {
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
// The provider is named once (icon + account name); the meta line carries only
// the date.
const ADDED_META_RE = /^Added /;

describe('IntegrationsSettingsPage', () => {
  test('renders the settings shell and delegates to the integration gallery', async () => {
    configureApiClient({
      baseUrl: 'https://api.example.test',
      fetchImpl: fetchForIntegrations(),
    });

    renderPage();

    expect(await screen.findByRole('heading', {name: 'Workspace settings'})).toBeVisible();
    expect(screen.getByRole('link', {name: INTEGRATIONS_LINK_RE})).toBeVisible();
    expect(await screen.findByRole('region', {name: 'Installed integrations'})).toBeInTheDocument();
    expect(screen.getByRole('region', {name: 'Available integrations'})).toBeInTheDocument();
    expect(await screen.findByText('Connected')).toBeVisible();
    expect(screen.getByText('acme-corp')).toBeVisible();
    expect(screen.getByText(ADDED_META_RE)).toBeVisible();
  });
});
