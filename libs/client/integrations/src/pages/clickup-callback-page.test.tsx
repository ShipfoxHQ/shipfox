// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import {ApiError} from '@shipfox/client-api';
import {authStateAtom} from '@shipfox/client-auth';
import {act, screen, waitFor} from '@testing-library/react';
import {useSetAtom} from 'jotai';
import {type ReactNode, StrictMode, useEffect} from 'react';
import {CLICKUP_INSTALL_WORKSPACE_KEY} from '#clickup-callback.js';
import {INTEGRATIONS_TEST_WID, renderIntegrationsPage, testWorkspace} from '#test/render.js';
import {ClickUpCallbackPage} from './clickup-callback-page.js';

const {completeCallbackMock} = vi.hoisted(() => ({completeCallbackMock: vi.fn()}));
const WORKSPACE_COUNT_MESSAGE = /exactly one ClickUp workspace/u;

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
    useCompleteClickUpCallbackMutation: () => ({mutateAsync: completeCallbackMock}),
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

describe('ClickUpCallbackPage', () => {
  it('submits the callback once in Strict Mode and navigates to the response workspace', async () => {
    const responseWorkspaceId = '22222222-2222-4222-8222-222222222222';
    window.sessionStorage.setItem(CLICKUP_INSTALL_WORKSPACE_KEY, INTEGRATIONS_TEST_WID);
    completeCallbackMock.mockResolvedValue({
      id: 'connection-1',
      workspaceId: responseWorkspaceId,
      provider: 'clickup',
      externalAccountId: 'team-1',
      slug: 'clickup_acme',
      displayName: 'ClickUp Acme',
      lifecycleStatus: 'active',
      capabilities: ['agent_tools'],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });

    renderIntegrationsPage({
      path: '/integrations/clickup/callback?code=grant-code&state=signed-state',
      routePath: '/integrations/clickup/callback',
      element: (
        <StrictMode>
          <ClickUpCallbackPage />
        </StrictMode>
      ),
      workspaces: [
        testWorkspace(),
        testWorkspace({id: responseWorkspaceId, slug: 'response-workspace'}),
      ],
      extraRoutes: [
        '/w/response-workspace/settings/integrations',
        '/w/$workspaceSlug/integrations/clickup',
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
    expect(window.sessionStorage.getItem(CLICKUP_INSTALL_WORKSPACE_KEY)).toBeNull();
    expect(screen.getByText('ClickUp installed.')).toBeInTheDocument();
  });

  it('waits for auth before submitting the original callback query', async () => {
    let completeAuth!: () => void;
    const onAuthReady = (complete: () => void) => {
      completeAuth = complete;
    };
    completeCallbackMock.mockResolvedValue({
      id: 'connection-cold-auth',
      workspaceId: INTEGRATIONS_TEST_WID,
      provider: 'clickup',
      externalAccountId: 'team-cold-auth',
      slug: 'clickup_cold_auth',
      displayName: 'ClickUp Cold Auth',
      lifecycleStatus: 'active',
      capabilities: ['agent_tools'],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });

    renderIntegrationsPage({
      path: '/integrations/clickup/callback?code=cold-grant-code&state=cold-signed-state',
      routePath: '/integrations/clickup/callback',
      element: (
        <AuthCompletionTrigger onReady={onAuthReady}>
          <ClickUpCallbackPage />
        </AuthCompletionTrigger>
      ),
      loadingAuth: true,
      extraRoutes: ['/w/$workspaceSlug/settings/integrations', '/auth/login'],
    });

    expect(await screen.findByRole('status', {name: 'Connecting ClickUp'})).toBeInTheDocument();
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

  it('maps the workspace-count error without retrying the grant code', async () => {
    completeCallbackMock.mockRejectedValue(
      new ApiError({
        code: 'clickup-workspace-count',
        message: 'ambiguous workspace grant',
        status: 422,
      }),
    );

    renderIntegrationsPage({
      path: '/integrations/clickup/callback?code=grant-code-error&state=signed-state-error',
      routePath: '/integrations/clickup/callback',
      element: <ClickUpCallbackPage />,
      extraRoutes: ['/w/$workspaceSlug/integrations/clickup', '/auth/login'],
    });

    expect(
      await screen.findByRole('heading', {name: 'One ClickUp workspace required'}),
    ).toBeVisible();
    expect(screen.getByText(WORKSPACE_COUNT_MESSAGE)).toBeVisible();
    expect(completeCallbackMock).toHaveBeenCalledTimes(1);
  });
});
