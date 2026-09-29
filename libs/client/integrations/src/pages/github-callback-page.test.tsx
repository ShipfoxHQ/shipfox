// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import {ApiError, configureApiClient} from '@shipfox/client-api';
import type {ClientAnalytics} from '@shipfox/client-shell/runtime';
import {QueryClient} from '@tanstack/react-query';
import {act, screen, waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {StrictMode} from 'react';
import {GITHUB_INSTALL_WORKSPACE_KEY, type GithubCallbackSearch} from '#github-callback.js';
import {
  INTEGRATIONS_TEST_WID,
  jsonResponse,
  renderIntegrationsPage,
  testWorkspace,
} from '#test/render.js';
import {GithubCallbackPage} from './github-callback-page.js';

const {
  completeGithubCallbackMock,
  completeGithubLinkMock,
  createGithubLinkMock,
  refreshAuthMock,
  resolveWorkspaceSlugMock,
  selectGithubLinkInstallationMock,
} = vi.hoisted(() => ({
  completeGithubCallbackMock: vi.fn(),
  completeGithubLinkMock: vi.fn(),
  selectGithubLinkInstallationMock: vi.fn(),
  createGithubLinkMock: vi.fn<(body: unknown) => Promise<Response>>(),
  refreshAuthMock: vi.fn(),
  resolveWorkspaceSlugMock: vi.fn(),
}));
const AUTH_LINK_NAME = /sign up|create account/iu;
const WORKSPACE_ACTION_LINK_NAME = /Open workspace|Invite a teammate/iu;
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
  return {
    ...actual,
    completeGithubCallback: completeGithubCallbackMock,
    completeGithubLink: completeGithubLinkMock,
    selectGithubLinkInstallation: selectGithubLinkInstallationMock,
  };
});

vi.mock('#workspace-navigation.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('#workspace-navigation.js')>();
  return {
    ...actual,
    resolveWorkspaceSlug: resolveWorkspaceSlugMock,
  };
});

function githubLinkSelection() {
  return {
    candidates: [
      {
        installationId: 123,
        accountLogin: 'acme',
        accountType: 'Organization',
        repositorySelection: 'all',
      },
      {
        installationId: 456,
        accountLogin: 'octocat',
        accountType: 'User',
        repositorySelection: 'all',
      },
    ],
    selectionToken: 'selection-secret-token',
  };
}

function githubConnection() {
  return {
    id: 'connection-1',
    workspaceId: INTEGRATIONS_TEST_WID,
    provider: 'github',
    externalAccountId: '456',
    slug: 'github_octocat',
    displayName: 'GitHub octocat',
    lifecycleStatus: 'active',
    capabilities: ['source_control'],
    createdAt: '2026-09-29T12:00:00.000Z',
    updatedAt: '2026-09-29T12:00:00.000Z',
  };
}

function twoWorkspaces() {
  return [
    testWorkspace(),
    testWorkspace({id: SECOND_WORKSPACE_ID, name: 'Beta', slug: 'beta', membershipId: 'm-2'}),
  ];
}

function renderCallback(
  search: GithubCallbackSearch,
  options: {
    analytics?: ClientAnalytics;
    assignLocation?: (url: string) => void;
    guest?: boolean;
    strict?: boolean;
    workspaces?: ReturnType<typeof testWorkspace>[];
  } = {},
) {
  const page = (
    <GithubCallbackPage
      search={search}
      {...(options.assignLocation ? {assignLocation: options.assignLocation} : {})}
    />
  );
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
  completeGithubLinkMock.mockReset();
  selectGithubLinkInstallationMock.mockReset();
  createGithubLinkMock
    .mockReset()
    .mockImplementation(async () => jsonResponse({authorize_url: 'https://github.test/authorize'}));
  // The link start goes through fetch: start-github-link is shared with other test files, so a
  // module mock would not reach it once another file has loaded it (isolate: false).
  configureApiClient({
    baseUrl: 'https://api.example.test',
    fetchImpl: async (input) => await createGithubLinkMock(await (input as Request).clone().json()),
  });
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
  test('renders request guidance before completion validation without workspace actions', async () => {
    const capture = vi.fn<ClientAnalytics['capture']>();
    const analytics = {capture};
    window.sessionStorage.setItem(GITHUB_INSTALL_WORKSPACE_KEY, INTEGRATIONS_TEST_WID);

    renderCallback({setupAction: 'request'}, {analytics});

    expect(await screen.findByRole('heading', {name: 'GitHub approval requested'})).toBeVisible();
    expect(
      screen.getByText(
        "GitHub sent the request to your organization's administrators. No Shipfox connection was created yet. Go to Shipfox to continue.",
      ),
    ).toBeVisible();
    expect(screen.getByRole('link', {name: 'Go to Shipfox'})).toHaveAttribute('href', '/');
    expect(screen.queryByRole('link', {name: WORKSPACE_ACTION_LINK_NAME})).not.toBeInTheDocument();
    expect(completeGithubCallbackMock).not.toHaveBeenCalled();
    expect(window.sessionStorage.getItem(GITHUB_INSTALL_WORKSPACE_KEY)).toBeNull();
    expect(capture).toHaveBeenCalledWith('github_install_request_viewed', {
      viewer: 'member',
      workspace_id: INTEGRATIONS_TEST_WID,
    });
    expect(capture).toHaveBeenCalledWith('github_callback_outcome', {
      outcome: 'request',
      missing: '',
      setup_action: 'request',
      authenticated: true,
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
    expect(capture).toHaveBeenCalledWith('github_callback_outcome', {
      outcome: 'guest',
      missing: '',
      setup_action: 'other',
      authenticated: false,
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
    expect(capture).toHaveBeenCalledWith('github_callback_outcome', {
      outcome: 'guest',
      missing: '',
      setup_action: 'other',
      authenticated: false,
    });
  });

  test('tells a guest when the callback link is invalid', async () => {
    const capture = vi.fn<ClientAnalytics['capture']>();

    renderCallback({}, {analytics: {capture}, guest: true});

    expect(
      await screen.findByRole('heading', {name: 'This GitHub request cannot be completed'}),
    ).toBeVisible();
    expect(
      screen.getByText(
        'This link is missing required information. Ask the person who sent you here to start the GitHub connection again.',
      ),
    ).toBeVisible();
    expect(screen.getByRole('link', {name: 'Go to Shipfox'})).toHaveAttribute('href', '/');
    expect(completeGithubCallbackMock).not.toHaveBeenCalled();
    expect(capture).toHaveBeenCalledWith('github_callback_guest_viewed', {outcome: 'invalid'});
    expect(capture).toHaveBeenCalledWith('github_callback_outcome', {
      outcome: 'guest',
      missing: 'code,installation_id,state',
      setup_action: 'other',
      authenticated: false,
    });
  });

  test('falls back to Shipfox when the workspace hint is stale', async () => {
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

    expect(await screen.findByRole('link', {name: 'Go to Shipfox'})).toHaveAttribute('href', '/');
    expect(screen.queryByRole('link', {name: WORKSPACE_ACTION_LINK_NAME})).not.toBeInTheDocument();
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
    expect(screen.getByRole('link', {name: 'Go to Shipfox'})).toHaveAttribute('href', '/');
    expect(screen.queryByRole('link', {name: WORKSPACE_ACTION_LINK_NAME})).not.toBeInTheDocument();
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

  test('keeps malformed callbacks on an explicit Shipfox recovery page', async () => {
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
    expect(
      screen.getByText(
        'This link is missing required callback information. Go to Shipfox to start the installation again.',
      ),
    ).toBeVisible();
    expect(screen.getByRole('link', {name: 'Go to Shipfox'})).toHaveAttribute('href', '/');
    expect(screen.queryByRole('link', {name: WORKSPACE_ACTION_LINK_NAME})).not.toBeInTheDocument();
    expect(completeGithubCallbackMock).not.toHaveBeenCalled();
  });

  test('reports and measures an incomplete callback once across remounts', async () => {
    const capture = vi.fn<ClientAnalytics['capture']>();
    const reportError = vi.fn();
    vi.stubGlobal('reportError', reportError);
    const search = {
      code: 'incomplete-secret-code',
      installationId: 42,
      setupAction: 'update',
    } satisfies GithubCallbackSearch;

    const firstRender = renderCallback(search, {
      analytics: {capture},
      strict: true,
      workspaces: twoWorkspaces(),
    });

    expect(await screen.findByRole('heading', {name: 'Invalid GitHub callback'})).toBeVisible();
    await waitFor(() => expect(reportError).toHaveBeenCalledOnce());
    expect(reportError).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'GithubCallbackIncompleteError',
        message: 'GitHub callback missing state',
      }),
    );
    expect(JSON.stringify(reportError.mock.calls)).not.toContain('incomplete-secret-code');
    expect(capture).toHaveBeenCalledWith('github_callback_outcome', {
      outcome: 'invalid',
      missing: 'state',
      setup_action: 'update',
      authenticated: true,
    });

    firstRender.unmount();
    renderCallback(search, {analytics: {capture}, workspaces: twoWorkspaces()});

    await waitFor(() => {
      expect(
        capture.mock.calls.filter(([event]) => event === 'github_callback_outcome'),
      ).toHaveLength(1);
      expect(reportError).toHaveBeenCalledOnce();
    });
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
    expect(screen.queryByRole('link', {name: WORKSPACE_ACTION_LINK_NAME})).not.toBeInTheDocument();
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
    expect(screen.getByRole('link', {name: 'Go to Shipfox'})).toHaveAttribute('href', '/');
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
    expect(screen.getByRole('link', {name: 'Go to Shipfox'})).toHaveAttribute('href', '/');
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
    expect(screen.getByRole('link', {name: 'Go to Shipfox'})).toHaveAttribute('href', '/');
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

  test('preserves a newer workspace handoff when abandoned completion fails', async () => {
    let rejectCallback: ((reason: unknown) => void) | undefined;
    completeGithubCallbackMock.mockImplementation(
      async () =>
        await new Promise((_, reject) => {
          rejectCallback = reject;
        }),
    );
    window.sessionStorage.setItem(GITHUB_INSTALL_WORKSPACE_KEY, INTEGRATIONS_TEST_WID);

    const {unmount} = renderCallback({
      installationId: 42,
      code: 'unmounted-code',
      state: 'unmounted-state',
    });

    await waitFor(() => expect(completeGithubCallbackMock).toHaveBeenCalledOnce());
    expect(window.sessionStorage.getItem(GITHUB_INSTALL_WORKSPACE_KEY)).toBeNull();
    unmount();
    window.sessionStorage.setItem(GITHUB_INSTALL_WORKSPACE_KEY, SECOND_WORKSPACE_ID);
    await act(async () => rejectCallback?.(new Error('network down')));

    expect(window.sessionStorage.getItem(GITHUB_INSTALL_WORKSPACE_KEY)).toBe(SECOND_WORKSPACE_ID);
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
    await waitFor(() => {
      expect(resolveWorkspaceSlugMock).toHaveBeenCalledWith(
        expect.objectContaining({workspaceId: SECOND_WORKSPACE_ID, fallbackWorkspaces: workspaces}),
      );
    });
    expect(
      await screen.findByTestId('route:/w/$workspaceSlug/settings/integrations'),
    ).toBeInTheDocument();
    expect(window.sessionStorage.getItem(GITHUB_INSTALL_WORKSPACE_KEY)).toBeNull();
    expect(capture).toHaveBeenCalledWith('github_connection_completed', {
      workspace_id: SECOND_WORKSPACE_ID,
    });
    expect(capture).toHaveBeenCalledWith('github_callback_outcome', {
      outcome: 'complete',
      missing: '',
      setup_action: 'other',
      authenticated: true,
    });
    expect(JSON.stringify(capture.mock.calls)).not.toContain('success-code');
    expect(JSON.stringify(capture.mock.calls)).not.toContain('success-state');
    expect(screen.getAllByText('GitHub installed.')).toHaveLength(1);
  });

  describe('orphaned installation recovery', () => {
    test('starts the link flow for the stored workspace when it is still a membership', async () => {
      const capture = vi.fn<ClientAnalytics['capture']>();
      const assignLocation = vi.fn();
      window.sessionStorage.setItem(GITHUB_INSTALL_WORKSPACE_KEY, SECOND_WORKSPACE_ID);

      renderCallback(
        {code: 'grant-secret', installationId: 42, setupAction: 'update'},
        {analytics: {capture}, assignLocation, strict: true, workspaces: twoWorkspaces()},
      );

      await waitFor(() =>
        expect(assignLocation).toHaveBeenCalledWith('https://github.test/authorize'),
      );
      expect(createGithubLinkMock).toHaveBeenCalledOnce();
      expect(createGithubLinkMock).toHaveBeenCalledWith({workspace_id: SECOND_WORKSPACE_ID});
      expect(screen.queryByRole('heading', {name: 'Invalid GitHub callback'})).toBeNull();
      expect(capture).toHaveBeenCalledWith('github_link_started', {});
      expect(capture).toHaveBeenCalledWith('github_callback_outcome', {
        outcome: 'invalid',
        missing: 'state',
        setup_action: 'update',
        authenticated: true,
      });
      expect(JSON.stringify(capture.mock.calls)).not.toContain('grant-secret');
    });

    test('ignores a stale hint and uses the only membership', async () => {
      const assignLocation = vi.fn();
      window.sessionStorage.setItem(GITHUB_INSTALL_WORKSPACE_KEY, 'deleted-workspace');

      renderCallback({state: 'stale-hint'}, {assignLocation});

      await waitFor(() => expect(assignLocation).toHaveBeenCalledOnce());
      expect(createGithubLinkMock).toHaveBeenCalledWith({workspace_id: INTEGRATIONS_TEST_WID});
    });

    test('uses the only membership when there is no hint', async () => {
      const assignLocation = vi.fn();

      renderCallback({}, {assignLocation});

      await waitFor(() => expect(assignLocation).toHaveBeenCalledOnce());
      expect(createGithubLinkMock).toHaveBeenCalledWith({workspace_id: INTEGRATIONS_TEST_WID});
    });

    test('keeps the invalid outcome with several memberships and no usable hint', async () => {
      window.sessionStorage.setItem(GITHUB_INSTALL_WORKSPACE_KEY, 'deleted-workspace');

      renderCallback({state: 'several'}, {workspaces: twoWorkspaces()});

      expect(await screen.findByRole('heading', {name: 'Invalid GitHub callback'})).toBeVisible();
      expect(createGithubLinkMock).not.toHaveBeenCalled();
    });

    test('keeps the invalid outcome when the link flow cannot start', async () => {
      const assignLocation = vi.fn();
      createGithubLinkMock.mockRejectedValue(new Error('network down'));
      const capture = vi.fn<ClientAnalytics['capture']>();

      renderCallback({state: 'start-fails'}, {analytics: {capture}, assignLocation});

      expect(await screen.findByRole('heading', {name: 'Invalid GitHub callback'})).toBeVisible();
      expect(assignLocation).not.toHaveBeenCalled();
      expect(capture).toHaveBeenCalledWith('github_link_failed', {reason: 'start-failed'});
    });

    test('makes no API call for guests', async () => {
      renderCallback({state: 'guest'}, {guest: true});

      expect(
        await screen.findByRole('heading', {name: 'This GitHub request cannot be completed'}),
      ).toBeVisible();
      expect(createGithubLinkMock).not.toHaveBeenCalled();
    });

    test('makes no API call for members without a workspace', async () => {
      renderCallback({state: 'no-membership'}, {workspaces: []});

      expect(
        await screen.findByText('This account is not a member of a Shipfox workspace.', {
          exact: false,
        }),
      ).toBeVisible();
      expect(createGithubLinkMock).not.toHaveBeenCalled();
    });

    test('makes no API call for request landings', async () => {
      renderCallback({setupAction: 'request'});

      expect(await screen.findByRole('heading', {name: 'GitHub approval requested'})).toBeVisible();
      expect(createGithubLinkMock).not.toHaveBeenCalled();
      expect(completeGithubLinkMock).not.toHaveBeenCalled();
    });

    test('completes a link landing, records telemetry and navigates to the workspace', async () => {
      const capture = vi.fn<ClientAnalytics['capture']>();
      completeGithubLinkMock.mockResolvedValue({
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
        {code: 'link-secret-code', state: 'link-secret-state'},
        {analytics: {capture}, strict: true},
      );

      expect(
        await screen.findByTestId('route:/w/$workspaceSlug/settings/integrations'),
      ).toBeInTheDocument();
      expect(completeGithubLinkMock).toHaveBeenCalledOnce();
      expect(completeGithubLinkMock).toHaveBeenCalledWith(
        {code: 'link-secret-code', state: 'link-secret-state'},
        'test-token',
      );
      expect(completeGithubCallbackMock).not.toHaveBeenCalled();
      expect(capture).toHaveBeenCalledWith('github_callback_outcome', {
        outcome: 'link',
        missing: '',
        setup_action: 'other',
        authenticated: true,
      });
      expect(capture).toHaveBeenCalledWith('github_link_completed', {candidates: '1'});
      expect(capture).toHaveBeenCalledWith('github_connection_completed', {
        workspace_id: INTEGRATIONS_TEST_WID,
      });
      expect(JSON.stringify(capture.mock.calls)).not.toContain('link-secret');
    });

    test.each([
      [
        'not installed on any account',
        {accessible: 0, linked_elsewhere: 0},
        'Shipfox is not installed on any GitHub account you can access.',
      ],
      [
        'connected to another workspace',
        {accessible: 1, linked_elsewhere: 1},
        'already connected to another workspace',
      ],
    ])('explains when the installation is %s', async (name, details, text) => {
      const capture = vi.fn<ClientAnalytics['capture']>();
      completeGithubLinkMock.mockRejectedValue(
        new ApiError({
          code: 'github-no-linkable-installation',
          message: 'No linkable GitHub installation was found',
          status: 409,
          details: {code: 'github-no-linkable-installation', details},
        }),
      );

      renderCallback({code: `none-${name}`, state: 'none-state'}, {analytics: {capture}});

      expect(
        await screen.findByRole('heading', {name: 'No GitHub installation to connect'}),
      ).toBeVisible();
      expect(screen.getByText(text, {exact: false})).toBeVisible();
      expect(screen.getByText('SAML single sign-on', {exact: false})).toBeVisible();
      expect(screen.getByRole('link', {name: 'Go to Shipfox'})).toHaveAttribute('href', '/');
      expect(capture).toHaveBeenCalledWith('github_link_failed', {reason: 'no-linkable'});
    });

    test('lets the user choose among several installations and links the chosen one', async () => {
      const user = userEvent.setup();
      const capture = vi.fn<ClientAnalytics['capture']>();
      completeGithubLinkMock.mockResolvedValue(githubLinkSelection());
      selectGithubLinkInstallationMock.mockResolvedValue(githubConnection());

      renderCallback({code: 'pick-code', state: 'pick-state'}, {analytics: {capture}});

      expect(await screen.findByRole('heading', {name: 'Choose a GitHub account'})).toBeVisible();
      expect(screen.getByText('acme')).toBeVisible();
      expect(screen.getByText('Organization')).toBeVisible();
      expect(screen.getByText('octocat')).toBeVisible();
      expect(screen.getByText('Personal account')).toBeVisible();
      await user.click(screen.getByRole('button', {name: 'Connect octocat'}));

      expect(
        await screen.findByTestId('route:/w/$workspaceSlug/settings/integrations'),
      ).toBeInTheDocument();
      expect(selectGithubLinkInstallationMock).toHaveBeenCalledWith(
        {selection_token: 'selection-secret-token', installation_id: 456},
        'test-token',
      );
      expect(capture).toHaveBeenCalledWith('github_link_completed', {candidates: 'many'});
      expect(capture).not.toHaveBeenCalledWith('github_link_completed', {candidates: '1'});
      expect(JSON.stringify(capture.mock.calls)).not.toContain('selection-secret');
      expect(JSON.stringify(window.sessionStorage)).not.toContain('selection-secret');
      expect(window.location.href).not.toContain('selection-secret');
    });

    test('keeps the picker and explains an expired selection', async () => {
      const user = userEvent.setup();
      const capture = vi.fn<ClientAnalytics['capture']>();
      completeGithubLinkMock.mockResolvedValue(githubLinkSelection());
      selectGithubLinkInstallationMock.mockRejectedValue(
        new ApiError({
          code: 'invalid-github-link-selection',
          message: 'Expired GitHub link selection',
          status: 400,
        }),
      );

      renderCallback({code: 'expired-code', state: 'expired-state'}, {analytics: {capture}});

      await user.click(await screen.findByRole('button', {name: 'Connect acme'}));

      expect(await screen.findByRole('alert')).toHaveTextContent('expired');
      expect(screen.getByRole('button', {name: 'Connect acme'})).toBeEnabled();
      expect(capture).toHaveBeenCalledWith('github_link_failed', {reason: 'expired'});
    });

    test('reports a selection network failure without forwarding the selection token', async () => {
      const user = userEvent.setup();
      const reportError = vi.fn();
      vi.stubGlobal('reportError', reportError);
      completeGithubLinkMock.mockResolvedValue(githubLinkSelection());
      selectGithubLinkInstallationMock.mockRejectedValue(
        new ApiError({
          code: 'network-error',
          message: 'POST https://api.example.test/integrations/github/link/select failed',
          status: 0,
        }),
      );

      renderCallback({code: 'network-pick-code', state: 'network-pick-state'});

      await user.click(await screen.findByRole('button', {name: 'Connect acme'}));

      await waitFor(() => expect(reportError).toHaveBeenCalledOnce());
      expect(JSON.stringify(reportError.mock.calls)).not.toContain('selection-secret');
      expect(screen.getByRole('button', {name: 'Connect acme'})).toBeEnabled();
    });

    test('tells the user to contact support when there are too many installations to list', async () => {
      const capture = vi.fn<ClientAnalytics['capture']>();
      completeGithubLinkMock.mockRejectedValue(
        new ApiError({
          code: 'github-too-many-linkable-installations',
          message: 'Too many linkable GitHub installations were found to choose from',
          status: 409,
          details: {count: 21},
        }),
      );

      renderCallback({code: 'many-code', state: 'many-state'}, {analytics: {capture}});

      expect(
        await screen.findByRole('heading', {name: 'Too many GitHub installations found'}),
      ).toBeVisible();
      expect(screen.getByText('Contact support', {exact: false})).toBeVisible();
      expect(capture).toHaveBeenCalledWith('github_link_failed', {reason: 'too-many-linkable'});
    });
  });
});
