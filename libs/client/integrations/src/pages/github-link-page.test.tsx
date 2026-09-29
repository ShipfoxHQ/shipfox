// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import {configureApiClient} from '@shipfox/client-api';
import type {ClientAnalytics} from '@shipfox/client-shell/runtime';
import {screen, waitFor} from '@testing-library/react';
import {INTEGRATIONS_TEST_WID, jsonResponse, renderIntegrationsPage} from '#test/render.js';
import {GithubLinkPage} from './github-link-page.js';

// Goes through fetch, not a module mock: start-github-link is shared with other test files, so
// a module mock would not reach it once another file has loaded it (isolate: false).
const linkStartMock = vi.fn<(body: unknown) => Promise<Response>>();

function renderLinkPage(assignLocation: (url: string) => void, analytics: ClientAnalytics) {
  return renderIntegrationsPage({
    path: '/w/acme/integrations/github/link',
    routePath: '/w/$workspaceSlug/integrations/github/link',
    element: <GithubLinkPage assignLocation={assignLocation} />,
    clientAnalytics: analytics,
    extraRoutes: ['/w/$workspaceSlug/integrations'],
  });
}

beforeEach(() => {
  linkStartMock.mockReset();
  configureApiClient({
    baseUrl: 'https://api.example.test',
    fetchImpl: async (input) => await linkStartMock(await (input as Request).clone().json()),
  });
});

describe('GithubLinkPage', () => {
  test('starts the link flow for the active workspace and leaves the app', async () => {
    const capture = vi.fn<ClientAnalytics['capture']>();
    const assignLocation = vi.fn();
    linkStartMock.mockResolvedValue(jsonResponse({authorize_url: 'https://github.test/authorize'}));

    renderLinkPage(assignLocation, {capture});

    await waitFor(() =>
      expect(assignLocation).toHaveBeenCalledWith('https://github.test/authorize'),
    );
    expect(linkStartMock).toHaveBeenCalledWith({workspace_id: INTEGRATIONS_TEST_WID});
    expect(capture).toHaveBeenCalledWith('github_link_started', {});
  });

  test('shows the error and a way back when the link flow cannot start', async () => {
    const capture = vi.fn<ClientAnalytics['capture']>();
    linkStartMock.mockResolvedValue(
      jsonResponse({code: 'provider-unavailable', message: 'GitHub is unavailable'}, {status: 503}),
    );

    renderLinkPage(vi.fn(), {capture});

    expect(await screen.findByText('GitHub is unavailable')).toBeVisible();
    expect(capture).toHaveBeenCalledWith('github_link_failed', {reason: 'start-failed'});
  });
});
