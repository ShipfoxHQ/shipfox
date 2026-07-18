import {configureApiClient} from '@shipfox/client-api';
import {screen} from '@testing-library/react';
import {
  jsonResponse,
  renderWorkspaceSettingsPage,
  WORKSPACE_SETTINGS_TEST_WID,
} from '#test/pages.js';
import {RunnersSettingsPage} from './runners-settings-page.js';

describe('RunnersSettingsPage', () => {
  test('renders the manual registration token section', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({manual_registration_tokens: []}));
    configureApiClient({baseUrl: 'https://api.example.test', fetchImpl});

    renderWorkspaceSettingsPage(
      `/workspaces/${WORKSPACE_SETTINGS_TEST_WID}/settings/runners`,
      <RunnersSettingsPage />,
    );

    expect(await screen.findByText('No usable manual registration tokens')).toBeVisible();
    expect(screen.getByRole('button', {name: 'Create token'})).toBeVisible();
  });
});
