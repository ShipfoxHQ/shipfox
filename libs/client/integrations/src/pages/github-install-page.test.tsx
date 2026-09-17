// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import {screen} from '@testing-library/react';
import {GITHUB_INSTALL_WORKSPACE_KEY} from '#github-callback.js';
import {INTEGRATIONS_TEST_WID, renderIntegrationsPage} from '#test/render.js';
import {GithubInstallPage} from './github-install-page.js';

const {createGithubInstallMock} = vi.hoisted(() => ({
  createGithubInstallMock: vi.fn(),
}));

vi.mock('#hooks/api/integrations.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('#hooks/api/integrations.js')>();
  return {...actual, createGithubInstall: createGithubInstallMock};
});

beforeEach(() => {
  window.sessionStorage.clear();
  createGithubInstallMock.mockReset();
});

test('clears the workspace handoff when the install request fails', async () => {
  createGithubInstallMock.mockImplementation(() => {
    expect(window.sessionStorage.getItem(GITHUB_INSTALL_WORKSPACE_KEY)).toBe(INTEGRATIONS_TEST_WID);
    return Promise.reject(new Error('network down'));
  });

  renderIntegrationsPage({
    path: '/w/acme/integrations/github',
    routePath: '/w/$workspaceSlug/integrations/github',
    element: <GithubInstallPage />,
    extraRoutes: ['/w/$workspaceSlug/integrations'],
  });

  expect(await screen.findByText('Could not start GitHub install.')).toBeInTheDocument();
  expect(createGithubInstallMock).toHaveBeenCalledWith({workspace_id: INTEGRATIONS_TEST_WID});
  expect(window.sessionStorage.getItem(GITHUB_INSTALL_WORKSPACE_KEY)).toBeNull();
});
