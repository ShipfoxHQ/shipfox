import {configureApiClient} from '@shipfox/client-api';
import {screen} from '@testing-library/react';
import {
  jsonResponse,
  renderWorkspaceSettingsPage,
  WORKSPACE_SETTINGS_TEST_WID,
} from '#test/pages.js';
import {AgentProvidersSettingsPage} from './agent-providers-settings-page.js';

describe('AgentProvidersSettingsPage', () => {
  test('renders the settings shell and agent providers section', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          providers: [
            {
              id: 'anthropic',
              label: 'Anthropic',
              support_status: 'supported',
              default_model: 'claude-opus-4-8',
              credential_fields: [{key: 'api_key', label: 'API key', secret: true}],
              unsupported_reason: null,
              models: [{id: 'claude-opus-4-8', label: 'Claude Opus 4.8'}],
            },
          ],
        }),
      )
      .mockResolvedValueOnce(jsonResponse({configs: [], default_provider_id: null}));
    configureApiClient({baseUrl: 'https://api.example.test', fetchImpl});

    renderWorkspaceSettingsPage(
      `/workspaces/${WORKSPACE_SETTINGS_TEST_WID}/settings/agent-providers`,
      <AgentProvidersSettingsPage />,
    );

    expect(await screen.findByRole('heading', {name: 'Workspace settings'})).toBeVisible();
    expect(await screen.findByText('No providers configured')).toBeVisible();
    expect(screen.getByText('Available providers')).toBeVisible();
    expect(screen.getByRole('button', {name: 'Configure Anthropic'})).toBeVisible();
  });
});
