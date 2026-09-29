// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import {ApiError} from '@shipfox/client-api';
import {authStateAtom} from '@shipfox/client-auth';
import {act, screen, waitFor} from '@testing-library/react';
import {useSetAtom} from 'jotai';
import {type ReactNode, StrictMode, useEffect} from 'react';
import {DISCORD_INSTALL_WORKSPACE_KEY} from '#discord-callback.js';
import {INTEGRATIONS_TEST_WID, renderIntegrationsPage, testWorkspace} from '#test/render.js';
import {DiscordCallbackPage} from './discord-callback-page.js';

const {completeCallbackMock} = vi.hoisted(() => ({completeCallbackMock: vi.fn()}));
const ACCESS_DENIED_COPY = /cancelled or the server install was not approved/u;

vi.mock('@shipfox/client-auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@shipfox/client-auth')>();
  return {
    ...actual,
    useRefreshAuth: () => () => Promise.resolve({accessToken: 'test-token'}),
  };
});

vi.mock('#hooks/api/integrations.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('#hooks/api/integrations.js')>();
  return {
    ...actual,
    useCompleteDiscordCallbackMutation: () => ({mutateAsync: completeCallbackMock}),
  };
});

function AuthCompletionTrigger({
  children,
  onReady,
}: {
  children: ReactNode;
  onReady: (complete: () => void) => void;
}) {
  const setAuth = useSetAtom(authStateAtom);

  useEffect(() => {
    onReady(() =>
      setAuth({
        status: 'authenticated',
        workspaces: [testWorkspace()],
      }),
    );
  }, [onReady, setAuth]);

  return children;
}

beforeEach(() => {
  window.sessionStorage.clear();
  completeCallbackMock.mockReset();
});

describe('DiscordCallbackPage', () => {
  it('submits the callback once in Strict Mode and navigates to the response workspace', async () => {
    const responseWorkspaceId = '22222222-2222-4222-8222-222222222222';
    window.sessionStorage.setItem(DISCORD_INSTALL_WORKSPACE_KEY, INTEGRATIONS_TEST_WID);
    completeCallbackMock.mockResolvedValue({
      id: 'connection-1',
      workspaceId: responseWorkspaceId,
      provider: 'discord',
      externalAccountId: 'team-1',
      slug: 'discord_acme',
      displayName: 'Discord Acme',
      lifecycleStatus: 'active',
      capabilities: ['agent_tools'],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });

    renderIntegrationsPage({
      path: '/integrations/discord/callback?code=grant-code&state=signed-state',
      routePath: '/integrations/discord/callback',
      element: (
        <StrictMode>
          <DiscordCallbackPage />
        </StrictMode>
      ),
      workspaces: [
        testWorkspace(),
        testWorkspace({id: responseWorkspaceId, slug: 'response-workspace'}),
      ],
      extraRoutes: [
        '/w/response-workspace/settings/integrations',
        '/w/$workspaceSlug/integrations/discord',
        '/auth/login',
      ],
    });

    await waitFor(() =>
      expect(completeCallbackMock).toHaveBeenCalledWith({
        query: {code: 'grant-code', state: 'signed-state'},
        token: 'test-token',
      }),
    );
    expect(completeCallbackMock).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect(
        screen.getByTestId('route:/w/response-workspace/settings/integrations'),
      ).toBeInTheDocument(),
    );
    expect(window.sessionStorage.getItem(DISCORD_INSTALL_WORKSPACE_KEY)).toBeNull();
    expect(screen.getByText('Discord installed.')).toBeInTheDocument();
  });

  it('waits for auth before submitting the original callback query', async () => {
    let completeAuth!: () => void;
    const onAuthReady = (complete: () => void) => {
      completeAuth = complete;
    };
    completeCallbackMock.mockResolvedValue({
      id: 'connection-cold-auth',
      workspaceId: INTEGRATIONS_TEST_WID,
      provider: 'discord',
      externalAccountId: 'team-cold-auth',
      slug: 'discord_cold_auth',
      displayName: 'Discord Cold Auth',
      lifecycleStatus: 'active',
      capabilities: ['agent_tools'],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });

    renderIntegrationsPage({
      path: '/integrations/discord/callback?code=cold-grant-code&state=cold-signed-state',
      routePath: '/integrations/discord/callback',
      element: (
        <AuthCompletionTrigger onReady={onAuthReady}>
          <DiscordCallbackPage />
        </AuthCompletionTrigger>
      ),
      loadingAuth: true,
      extraRoutes: ['/w/$workspaceSlug/settings/integrations', '/auth/login'],
    });

    expect(await screen.findByRole('status', {name: 'Connecting Discord'})).toBeInTheDocument();
    expect(completeCallbackMock).not.toHaveBeenCalled();

    act(() => {
      completeAuth();
    });

    await waitFor(() =>
      expect(completeCallbackMock).toHaveBeenCalledWith({
        query: {code: 'cold-grant-code', state: 'cold-signed-state'},
        token: 'test-token',
      }),
    );
    expect(completeCallbackMock).toHaveBeenCalledTimes(1);
  });

  it('uses neutral access-denied copy and links to the setup guide', async () => {
    completeCallbackMock.mockRejectedValue(
      new ApiError({
        code: 'access-denied',
        message: 'access denied',
        status: 403,
      }),
    );

    renderIntegrationsPage({
      path: '/integrations/discord/callback?code=grant-code-error&state=signed-state-error',
      routePath: '/integrations/discord/callback',
      element: <DiscordCallbackPage />,
      extraRoutes: ['/w/$workspaceSlug/integrations/discord', '/auth/login'],
    });

    expect(
      await screen.findByRole('heading', {name: 'Discord access was not granted'}),
    ).toBeVisible();
    expect(screen.getByText(ACCESS_DENIED_COPY)).toBeVisible();
    expect(screen.getByRole('link', {name: 'Read the Discord setup guide'})).toHaveAttribute(
      'href',
      'https://docs.shipfox.io/integrations/discord/setup',
    );
    expect(completeCallbackMock).toHaveBeenCalledTimes(1);
  });
});
