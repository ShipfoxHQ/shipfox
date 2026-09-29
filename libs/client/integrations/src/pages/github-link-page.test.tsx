// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import type {ClientAnalytics} from '@shipfox/client-shell/runtime';
import {screen, waitFor} from '@testing-library/react';
import {INTEGRATIONS_TEST_WID, renderIntegrationsPage} from '#test/render.js';
import {GithubLinkPage} from './github-link-page.js';

const {createGithubLinkMock} = vi.hoisted(() => ({createGithubLinkMock: vi.fn()}));

vi.mock('#hooks/api/integrations.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('#hooks/api/integrations.js')>();
  return {...actual, createGithubLink: createGithubLinkMock};
});

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
  createGithubLinkMock.mockReset();
});

describe('GithubLinkPage', () => {
  test('starts the link flow for the active workspace and leaves the app', async () => {
    const capture = vi.fn<ClientAnalytics['capture']>();
    const assignLocation = vi.fn();
    createGithubLinkMock.mockResolvedValue({authorizeUrl: 'https://github.test/authorize'});

    renderLinkPage(assignLocation, {capture});

    await waitFor(() =>
      expect(assignLocation).toHaveBeenCalledWith('https://github.test/authorize'),
    );
    expect(createGithubLinkMock).toHaveBeenCalledWith({workspace_id: INTEGRATIONS_TEST_WID});
    expect(capture).toHaveBeenCalledWith('github_link_started', {});
  });

  test('shows the error and a way back when the link flow cannot start', async () => {
    const capture = vi.fn<ClientAnalytics['capture']>();
    createGithubLinkMock.mockRejectedValue(new Error('network down'));

    renderLinkPage(vi.fn(), {capture});

    expect(await screen.findByText('Could not start the GitHub connection.')).toBeVisible();
    expect(capture).toHaveBeenCalledWith('github_link_failed', {reason: 'start-failed'});
  });
});
