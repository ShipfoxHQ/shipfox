import {configureApiClient} from '@shipfox/client-api';
import {screen} from '@testing-library/react';
import {
  jsonResponse,
  renderWorkspaceSettingsPage,
  WORKSPACE_SETTINGS_TEST_WID,
} from '#test/pages.js';
import {ProvisionersSettingsPage} from './provisioners-settings-page.js';

describe('ProvisionersSettingsPage', () => {
  test('renders the settings shell and provisioner token section', async () => {
    const fetchImpl = vi.fn((input: RequestInfo | URL) => {
      const request = input as Request;
      if (request.url.endsWith('/provisioners/active')) {
        return Promise.resolve(jsonResponse({provisioners: []}));
      }
      return Promise.resolve(jsonResponse({tokens: []}));
    });
    configureApiClient({baseUrl: 'https://api.example.test', fetchImpl});

    renderWorkspaceSettingsPage(
      `/workspaces/${WORKSPACE_SETTINGS_TEST_WID}/settings/provisioners`,
      <ProvisionersSettingsPage />,
    );

    expect(await screen.findByText('No usable provisioner registration tokens')).toBeVisible();
    expect(screen.getByRole('button', {name: 'Create token'})).toBeVisible();
  });
});
