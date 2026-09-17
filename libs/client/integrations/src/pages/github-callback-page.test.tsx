// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import {ApiError} from '@shipfox/client-api';
import type {ClientAnalytics} from '@shipfox/client-shell/runtime';
import {QueryClient} from '@tanstack/react-query';
import {screen, waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {StrictMode} from 'react';
import {GITHUB_INSTALL_WORKSPACE_KEY, type GithubCallbackSearch} from '#github-callback.js';
import {INTEGRATIONS_TEST_WID, renderIntegrationsPage, testWorkspace} from '#test/render.js';
import {GithubCallbackPage} from './github-callback-page.js';

const {completeGithubCallbackMock, refreshAuthMock, resolveWorkspaceSlugMock} = vi.hoisted(() => ({
  completeGithubCallbackMock: vi.fn(),
  refreshAuthMock: vi.fn(),
  resolveWorkspaceSlugMock: vi.fn(),
}));
const AUTH_LINK_NAME = /sign up|create account/iu;
const INVITE_TEAMMATE_LINK_NAME = /Invite a teammate/iu;
const MEMBER_WORKSPACE_LINK_NAME = /^Open workspace – .+$/u;
const SECOND_WORKSPACE_ID = '33333333-3333-4333-8333-333333333333';

vi.mock('@shipfox/client-auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@shipfox/client-auth')>();
  return {
    ...actual,
    useRefreshAuth: () => refreshAuthMock,
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
    resolveWorkspaceSlug: resolveWorkspaceSlugMock,
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
  refreshAuthMock.mockReset().mockResolvedValue({accessToken: 'test-token'});
  resolveWorkspaceSlugMock
    .mockReset()
    .mockImplementation(
      async ({
        workspaceId,
        fallbackWorkspaces,
      }: {
        workspaceId: string;
        fallbackWorkspaces: ReturnType<typeof testWorkspace>[];
      }) => fallbackWorkspaces.find(({id}) => id === workspaceId)?.slug,
    );
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
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

    expect(await screen.findByRole('heading', {name: 'GitHub request approved'})).toBeVisible();
    expect(
      screen.getByText(
        'Let the person who asked you to approve Shipfox know. They can now continue setup in Shipfox.',
      ),
    ).toBeVisible();
    expect(screen.getByRole('link', {name: 'Go to Shipfox'})).toHaveAttribute('href', '/');
    expect(screen.queryByRole('link', {name: AUTH_LINK_NAME})).not.toBeInTheDocument();
    expect(completeGithubCallbackMock).not.toHaveBeenCalled();
    expect(capture).toHaveBeenCalledWith('github_callback_guest_viewed', {
      outcome: 'complete',
    });
    expect(JSON.stringify(capture.mock.calls)).not.toContain('secret-code');
    expect(JSON.stringify(capture.mock.calls)).not.toContain('secret-state');
  });

  test('tells a guest when GitHub did not complete the request', async () => {
    const capture = vi.fn<ClientAnalytics['capture']>();

    renderCallback(
      {error: 'access_denied', errorDescription: 'The user denied access'},
      {analytics: {capture}, guest: true},
    );

    expect(
      await screen.findByRole('heading', {name: 'GitHub did not complete the request'}),
    ).toBeVisible();
    expect(screen.getByText('No connection was changed.', {exact: false})).toBeVisible();
    expect(document.body).not.toHaveTextContent('If you approved Shipfox in GitHub');
    expect(completeGithubCallbackMock).not.toHaveBeenCalled();
    expect(capture).toHaveBeenCalledWith('github_callback_guest_viewed', {
      outcome: 'provider-error',
    });
  });

  test('falls back to current memberships when the workspace hint is stale', async () => {
    const capture = vi.fn<ClientAnalytics['capture']>();
    const workspaces = [
      testWorkspace(),
      testWorkspace({
        id: SECOND_WORKSPACE_ID,
        name: 'Beta',
        slug: 'beta',
        membershipId: 'm-2',
      }),
    ];
    window.sessionStorage.setItem(GITHUB_INSTALL_WORKSPACE_KEY, 'deleted-workspace');

    renderCallback({setupAction: 'request'}, {analytics: {capture}, workspaces});

    expect(await screen.findByRole('link', {name: 'Open workspace – Acme'})).toHaveAttribute(
      'href',
      '/w/acme/integrations',
    );
    expect(screen.getByRole('link', {name: 'Open workspace – Beta'})).toHaveAttribute(
      'href',
      '/w/beta/integrations',
    );
    expect(capture).toHaveBeenCalledWith('github_install_request_viewed', {viewer: 'member'});
    expect(window.sessionStorage.getItem(GITHUB_INSTALL_WORKSPACE_KEY)).toBeNull();
  });

  test('distinguishes authenticated users without memberships from member recovery', async () => {
    renderCallback({setupAction: 'request'}, {workspaces: []});

    expect(
      await screen.findByText('This account is not a member of a Shipfox workspace.', {
        exact: false,
      }),
    ).toBeVisible();
    expect(screen.queryByRole('link', {name: MEMBER_WORKSPACE_LINK_NAME})).not.toBeInTheDocument();
  });

  test('preserves callback state when workspace membership hydration fails', async () => {
    const user = userEvent.setup();
    vi.spyOn(QueryClient.prototype, 'getQueryState').mockReturnValue({status: 'error'} as never);
    window.sessionStorage.setItem(GITHUB_INSTALL_WORKSPACE_KEY, INTEGRATIONS_TEST_WID);

    renderCallback(
      {installationId: 42, code: 'membership-code', state: 'membership-state'},
      {workspaces: []},
    );

    expect(
      await screen.findByRole('heading', {name: 'Could not load your workspaces'}),
    ).toBeVisible();
    await user.click(screen.getByRole('button', {name: 'Try again'}));

    expect(refreshAuthMock).toHaveBeenCalledOnce();
    expect(completeGithubCallbackMock).not.toHaveBeenCalled();
    expect(window.sessionStorage.getItem(GITHUB_INSTALL_WORKSPACE_KEY)).toBe(INTEGRATIONS_TEST_WID);
  });

  test('keeps malformed callbacks on an actionable member recovery page', async () => {
    const workspaces = [
      testWorkspace(),
      testWorkspace({
        id: SECOND_WORKSPACE_ID,
        name: 'Beta',
        slug: 'beta',
        membershipId: 'm-2',
      }),
    ];

    renderCallback({state: 'incomplete'}, {workspaces});

    const heading = await screen.findByRole('heading', {name: 'Invalid GitHub callback'});

    expect(heading).toBeVisible();
    expect(document.activeElement).toBe(heading);
    expect(screen.getByRole('link', {name: 'Open workspace – Acme'})).toBeVisible();
    expect(screen.getByRole('link', {name: 'Open workspace – Beta'})).toBeVisible();
    expect(screen.getByRole('link', {name: 'Invite a teammate to Acme'})).toBeVisible();
    expect(screen.getByRole('link', {name: 'Invite a teammate to Beta'})).toBeVisible();
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
      await screen.findByRole('heading', {
        name: 'This GitHub connection cannot be completed',
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'It was started with a different Shipfox account. Go to Shipfox and start the connection again.',
      ),
    ).toBeVisible();
    expect(window.sessionStorage.getItem(GITHUB_INSTALL_WORKSPACE_KEY)).toBeNull();
    expect(screen.getByRole('link', {name: 'Go to Shipfox'})).toHaveAttribute('href', '/');
    expect(screen.queryByRole('link', {name: MEMBER_WORKSPACE_LINK_NAME})).not.toBeInTheDocument();
    expect(screen.queryByRole('link', {name: INVITE_TEAMMATE_LINK_NAME})).not.toBeInTheDocument();
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

  test('renders fresh-install recovery for a provider failure', async () => {
    const reportError = vi.fn();
    vi.stubGlobal('reportError', reportError);
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
    expect(screen.queryByRole('button', {name: 'Try again'})).not.toBeInTheDocument();
    expect(screen.getByRole('link', {name: 'Open workspace – Acme'})).toBeVisible();
    expect(reportError).not.toHaveBeenCalled();
  });

  test('renders workspace-access recovery when callback membership changes', async () => {
    const reportError = vi.fn();
    vi.stubGlobal('reportError', reportError);
    completeGithubCallbackMock.mockRejectedValue(
      new ApiError({
        code: 'forbidden',
        message: 'Workspace membership required',
        status: 403,
      }),
    );

    renderCallback({installationId: 42, code: 'access-code', state: 'access-state'});

    expect(await screen.findByRole('heading', {name: 'Workspace access changed'})).toBeVisible();
    expect(screen.getByRole('link', {name: 'Open workspace – Acme'})).toBeVisible();
    expect(reportError).not.toHaveBeenCalled();
  });

  test('reports a network failure once without forwarding callback secrets', async () => {
    const reportError = vi.fn();
    vi.stubGlobal('reportError', reportError);
    completeGithubCallbackMock.mockRejectedValue(
      new ApiError({
        code: 'network-error',
        message:
          'GET https://api.example.test/integrations/github/callback?code=network-secret-code&state=network-secret-state failed',
        status: 0,
      }),
    );

    renderCallback({
      installationId: 42,
      code: 'network-secret-code',
      state: 'network-secret-state',
    });

    expect(
      await screen.findByRole('heading', {name: 'GitHub is temporarily unavailable'}),
    ).toBeVisible();
    expect(reportError).toHaveBeenCalledOnce();
    expect(reportError).toHaveBeenCalledWith(
      expect.objectContaining({message: 'Failed to complete the GitHub callback.'}),
    );
    expect((reportError.mock.calls[0]?.[0] as Error).cause).toBeUndefined();
    expect(JSON.stringify(reportError.mock.calls)).not.toContain('network-secret-code');
    expect(JSON.stringify(reportError.mock.calls)).not.toContain('network-secret-state');
  });

  test('reports an unexpected failure without exposing callback secrets', async () => {
    const reportError = vi.fn();
    vi.stubGlobal('reportError', reportError);
    completeGithubCallbackMock.mockRejectedValue(
      new Error(
        'GET https://api.example.test/integrations/github/callback?code=secret-code&state=secret-state failed',
      ),
    );

    renderCallback({installationId: 42, code: 'secret-code', state: 'secret-state'});

    expect(await screen.findByRole('heading', {name: 'Could not connect GitHub'})).toBeVisible();
    expect(document.body).not.toHaveTextContent('secret-code');
    expect(document.body).not.toHaveTextContent('secret-state');
    expect(document.body).not.toHaveTextContent('https://api.example.test');
    expect(reportError).toHaveBeenCalledOnce();
    expect(reportError).toHaveBeenCalledWith(
      expect.objectContaining({message: 'Failed to complete the GitHub callback.'}),
    );
    expect((reportError.mock.calls[0]?.[0] as Error).cause).toBeUndefined();
  });

  test('completes a direct install once, records API-confirmed telemetry, and navigates to its workspace', async () => {
    const capture = vi.fn<ClientAnalytics['capture']>();
    const analytics = {capture};
    const workspaces = [
      testWorkspace(),
      testWorkspace({
        id: SECOND_WORKSPACE_ID,
        name: 'Beta',
        slug: 'beta',
        membershipId: 'm-2',
      }),
    ];
    window.sessionStorage.setItem(GITHUB_INSTALL_WORKSPACE_KEY, INTEGRATIONS_TEST_WID);
    completeGithubCallbackMock.mockResolvedValue({
      id: '22222222-2222-4222-8222-222222222222',
      workspaceId: SECOND_WORKSPACE_ID,
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
      {analytics, strict: true, workspaces},
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
    expect(resolveWorkspaceSlugMock).toHaveBeenCalledWith(
      expect.objectContaining({workspaceId: SECOND_WORKSPACE_ID, fallbackWorkspaces: workspaces}),
    );
    expect(window.sessionStorage.getItem(GITHUB_INSTALL_WORKSPACE_KEY)).toBeNull();
    expect(capture).toHaveBeenCalledWith('github_connection_completed', {
      workspace_id: SECOND_WORKSPACE_ID,
    });
    expect(JSON.stringify(capture.mock.calls)).not.toContain('success-code');
    expect(JSON.stringify(capture.mock.calls)).not.toContain('success-state');
    expect(screen.getAllByText('GitHub installed.')).toHaveLength(1);
  });
});
