// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import {ApiError} from '@shipfox/client-api';
import type {ClientAnalytics} from '@shipfox/client-shell/runtime';
import {screen, waitFor} from '@testing-library/react';
import {StrictMode} from 'react';
import {GITHUB_INSTALL_WORKSPACE_KEY, type GithubCallbackSearch} from '#github-callback.js';
import {INTEGRATIONS_TEST_WID, renderIntegrationsPage, type testWorkspace} from '#test/render.js';
import {GithubCallbackPage} from './github-callback-page.js';

const {completeGithubCallbackMock} = vi.hoisted(() => ({completeGithubCallbackMock: vi.fn()}));
const AUTH_LINK_NAME = /sign up|create account/iu;

vi.mock('@shipfox/client-auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@shipfox/client-auth')>();
  return {
    ...actual,
    useRefreshAuth: () => () => Promise.resolve({accessToken: 'test-token'}),
  };
});

vi.mock('#hooks/api/integrations.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('#hooks/api/integrations.js')>();
  return {...actual, completeGithubCallback: completeGithubCallbackMock};
});

vi.mock('#workspace-navigation.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('#workspace-navigation.js')>();
  return {
    ...actual,
    resolveWorkspaceSlug: vi.fn(
      async ({
        workspaceId,
        fallbackWorkspaces,
      }: {
        workspaceId: string;
        fallbackWorkspaces: ReturnType<typeof testWorkspace>[];
      }) => fallbackWorkspaces.find(({id}) => id === workspaceId)?.slug,
    ),
  };
});

function renderCallback(
  search: GithubCallbackSearch,
  options: {
    analytics?: ClientAnalytics;
    guest?: boolean;
    strict?: boolean;
    workspaces?: ReturnType<typeof testWorkspace>[];
  } = {},
) {
  const page = <GithubCallbackPage search={search} />;
  return renderIntegrationsPage({
    path: '/integrations/github/callback',
    routePath: '/integrations/github/callback',
    element: options.strict ? <StrictMode>{page}</StrictMode> : page,
    ...(options.workspaces ? {workspaces: options.workspaces} : {}),
    ...(options.guest === undefined ? {} : {guestAuth: options.guest}),
    ...(options.analytics ? {clientAnalytics: options.analytics} : {}),
    extraRoutes: [
      '/w/$workspaceSlug/settings/integrations',
      '/w/$workspaceSlug/settings/members',
      '/w/$workspaceSlug/integrations',
    ],
  });
}

beforeEach(() => {
  window.sessionStorage.clear();
  completeGithubCallbackMock.mockReset();
});

describe('GithubCallbackPage', () => {
  test('renders request guidance before completion validation and uses an authorized workspace hint', async () => {
    const capture = vi.fn<ClientAnalytics['capture']>();
    const analytics = {capture};
    window.sessionStorage.setItem(GITHUB_INSTALL_WORKSPACE_KEY, INTEGRATIONS_TEST_WID);

    renderCallback({setupAction: 'request'}, {analytics});

    expect(
      await screen.findByRole('heading', {name: 'Approval requested on GitHub'}),
    ).toBeVisible();
    expect(screen.getByRole('link', {name: 'Return to workspace'})).toHaveAttribute(
      'href',
      '/w/acme/integrations',
    );
    expect(screen.getByRole('link', {name: 'Invite a teammate'})).toHaveAttribute(
      'href',
      '/w/acme/settings/members',
    );
    expect(completeGithubCallbackMock).not.toHaveBeenCalled();
    expect(window.sessionStorage.getItem(GITHUB_INSTALL_WORKSPACE_KEY)).toBeNull();
    expect(capture).toHaveBeenCalledWith('github_install_request_viewed', {
      viewer: 'member',
      workspace_id: INTEGRATIONS_TEST_WID,
    });
  });

  test('renders a terminal guest explanation without forcing signup', async () => {
    const capture = vi.fn<ClientAnalytics['capture']>();
    const analytics = {capture};

    renderCallback(
      {installationId: 42, code: 'secret-code', state: 'secret-state'},
      {
        analytics,
        guest: true,
      },
    );

    expect(
      await screen.findByRole('heading', {name: 'You can return to your teammate'}),
    ).toBeVisible();
    expect(screen.queryByRole('link', {name: AUTH_LINK_NAME})).not.toBeInTheDocument();
    expect(completeGithubCallbackMock).not.toHaveBeenCalled();
    expect(capture).toHaveBeenCalledWith('github_callback_guest_viewed', {
      outcome: 'complete',
    });
    expect(JSON.stringify(capture.mock.calls)).not.toContain('secret-code');
    expect(JSON.stringify(capture.mock.calls)).not.toContain('secret-state');
  });

  test('distinguishes authenticated users without memberships from member recovery', async () => {
    renderCallback({setupAction: 'request'}, {workspaces: []});

    expect(
      await screen.findByText('This account is not a member of a Shipfox workspace.', {
        exact: false,
      }),
    ).toBeVisible();
    expect(screen.queryByRole('link', {name: 'Open workspace'})).not.toBeInTheDocument();
  });

  test('keeps malformed callbacks on an actionable member recovery page', async () => {
    renderCallback({state: 'incomplete'});

    const heading = await screen.findByRole('heading', {name: 'Invalid GitHub callback'});

    expect(heading).toBeVisible();
    expect(document.activeElement).toBe(heading);
    expect(screen.getByRole('link', {name: 'Open workspace'})).toBeVisible();
    expect(completeGithubCallbackMock).not.toHaveBeenCalled();
  });

  test('renders actor mismatch recovery and clears the stale handoff', async () => {
    window.sessionStorage.setItem(GITHUB_INSTALL_WORKSPACE_KEY, INTEGRATIONS_TEST_WID);
    completeGithubCallbackMock.mockRejectedValue(
      new ApiError({
        code: 'github-install-state-actor-mismatch',
        message: 'different account',
        status: 403,
      }),
    );

    renderCallback({installationId: 42, code: 'actor-code', state: 'actor-state'});

    expect(
      await screen.findByRole('heading', {name: 'Use the account that started this install'}),
    ).toBeInTheDocument();
    expect(window.sessionStorage.getItem(GITHUB_INSTALL_WORKSPACE_KEY)).toBeNull();
    expect(screen.getByRole('link', {name: 'Open workspace'})).toBeVisible();
  });

  test('distinguishes expired state from a malformed callback', async () => {
    completeGithubCallbackMock.mockRejectedValue(
      new ApiError({
        code: 'invalid-github-install-state',
        message: 'Expired GitHub install state',
        status: 400,
      }),
    );

    renderCallback({installationId: 42, code: 'expired-code', state: 'expired-state'});

    expect(await screen.findByRole('heading', {name: 'GitHub callback expired'})).toBeVisible();
    expect(screen.queryByRole('button', {name: 'Try again'})).not.toBeInTheDocument();
  });

  test('offers retry for a provider failure', async () => {
    completeGithubCallbackMock.mockRejectedValue(
      new ApiError({
        code: 'provider-unavailable',
        message: 'GitHub unavailable',
        status: 503,
      }),
    );

    renderCallback({installationId: 42, code: 'provider-code', state: 'provider-state'});

    expect(
      await screen.findByRole('heading', {name: 'GitHub is temporarily unavailable'}),
    ).toBeVisible();
    expect(screen.getByRole('button', {name: 'Try again'})).toBeVisible();
  });

  test('completes a direct install once, records API-confirmed telemetry, and navigates to its workspace', async () => {
    const capture = vi.fn<ClientAnalytics['capture']>();
    const analytics = {capture};
    window.sessionStorage.setItem(GITHUB_INSTALL_WORKSPACE_KEY, INTEGRATIONS_TEST_WID);
    completeGithubCallbackMock.mockResolvedValue({
      id: '22222222-2222-4222-8222-222222222222',
      workspaceId: INTEGRATIONS_TEST_WID,
      provider: 'github',
      externalAccountId: 'github-org',
      slug: 'github_acme',
      displayName: 'GitHub Acme',
      lifecycleStatus: 'active',
      capabilities: ['source_control'],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });

    renderCallback(
      {installationId: 42, code: 'success-code', state: 'success-state'},
      {analytics, strict: true},
    );

    await waitFor(() => expect(completeGithubCallbackMock).toHaveBeenCalledTimes(1));
    expect(completeGithubCallbackMock).toHaveBeenCalledWith({
      installationId: 42,
      code: 'success-code',
      state: 'success-state',
      token: 'test-token',
    });
    expect(
      await screen.findByTestId('route:/w/$workspaceSlug/settings/integrations'),
    ).toBeInTheDocument();
    expect(window.sessionStorage.getItem(GITHUB_INSTALL_WORKSPACE_KEY)).toBeNull();
    expect(capture).toHaveBeenCalledWith('github_connection_completed', {
      workspace_id: INTEGRATIONS_TEST_WID,
    });
    expect(JSON.stringify(capture.mock.calls)).not.toContain('success-code');
    expect(JSON.stringify(capture.mock.calls)).not.toContain('success-state');
    expect(screen.getByText('GitHub installed.')).toBeInTheDocument();
  });
});
