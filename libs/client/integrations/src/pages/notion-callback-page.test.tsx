// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import {ApiError} from '@shipfox/client-api';
import {authStateAtom} from '@shipfox/client-auth';
import {act, screen, waitFor} from '@testing-library/react';
import {useSetAtom} from 'jotai';
import {type ReactNode, StrictMode, useEffect} from 'react';
import {NOTION_INSTALL_WORKSPACE_KEY} from '#notion-callback.js';
import {INTEGRATIONS_TEST_WID, renderIntegrationsPage, testWorkspace} from '#test/render.js';
import {NotionCallbackPage} from './notion-callback-page.js';

const {completeCallbackMock} = vi.hoisted(() => ({completeCallbackMock: vi.fn()}));
const ACCESS_DENIED_COPY = /cancelled or the workspace restricts connections/u;

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
    useCompleteNotionCallbackMutation: () => ({mutateAsync: completeCallbackMock}),
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

describe('NotionCallbackPage', () => {
  it('submits the callback once in Strict Mode and navigates to the response workspace', async () => {
    const responseWorkspaceId = '22222222-2222-4222-8222-222222222222';
    window.sessionStorage.setItem(NOTION_INSTALL_WORKSPACE_KEY, INTEGRATIONS_TEST_WID);
    completeCallbackMock.mockResolvedValue({
      id: 'connection-1',
      workspaceId: responseWorkspaceId,
      provider: 'notion',
      externalAccountId: 'team-1',
      slug: 'notion_acme',
      displayName: 'Notion Acme',
      lifecycleStatus: 'active',
      capabilities: ['agent_tools'],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });

    renderIntegrationsPage({
      path: '/integrations/notion/callback?code=grant-code&state=signed-state',
      routePath: '/integrations/notion/callback',
      element: (
        <StrictMode>
          <NotionCallbackPage />
        </StrictMode>
      ),
      workspaces: [
        testWorkspace(),
        testWorkspace({id: responseWorkspaceId, slug: 'response-workspace'}),
      ],
      extraRoutes: [
        '/w/response-workspace/settings/integrations',
        '/w/$workspaceSlug/integrations/notion',
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
    expect(window.sessionStorage.getItem(NOTION_INSTALL_WORKSPACE_KEY)).toBeNull();
    expect(screen.getByText('Notion installed.')).toBeInTheDocument();
  });

  it('waits for auth before submitting the original callback query', async () => {
    let completeAuth!: () => void;
    const onAuthReady = (complete: () => void) => {
      completeAuth = complete;
    };
    completeCallbackMock.mockResolvedValue({
      id: 'connection-cold-auth',
      workspaceId: INTEGRATIONS_TEST_WID,
      provider: 'notion',
      externalAccountId: 'team-cold-auth',
      slug: 'notion_cold_auth',
      displayName: 'Notion Cold Auth',
      lifecycleStatus: 'active',
      capabilities: ['agent_tools'],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });

    renderIntegrationsPage({
      path: '/integrations/notion/callback?code=cold-grant-code&state=cold-signed-state',
      routePath: '/integrations/notion/callback',
      element: (
        <AuthCompletionTrigger onReady={onAuthReady}>
          <NotionCallbackPage />
        </AuthCompletionTrigger>
      ),
      loadingAuth: true,
      extraRoutes: ['/w/$workspaceSlug/settings/integrations', '/auth/login'],
    });

    expect(await screen.findByRole('status', {name: 'Connecting Notion'})).toBeInTheDocument();
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
      path: '/integrations/notion/callback?code=grant-code-error&state=signed-state-error',
      routePath: '/integrations/notion/callback',
      element: <NotionCallbackPage />,
      extraRoutes: ['/w/$workspaceSlug/integrations/notion', '/auth/login'],
    });

    expect(
      await screen.findByRole('heading', {name: 'Notion access was not granted'}),
    ).toBeVisible();
    expect(screen.getByText(ACCESS_DENIED_COPY)).toBeVisible();
    expect(screen.getByRole('link', {name: 'Read the Notion setup guide'})).toHaveAttribute(
      'href',
      'https://docs.shipfox.io/integrations/notion/setup',
    );
    expect(completeCallbackMock).toHaveBeenCalledTimes(1);
  });
});
