// @vitest-environment jsdom
import {createMemoryHistory, createRootRoute, createRouter} from '@tanstack/react-router';
import {act, fireEvent, screen} from '@testing-library/react';
import {useEffect} from 'react';
import {defineClientFeature} from '#contract.js';
import {authStateAtom} from '#runtime/auth.js';
import {composeClientApp} from '#runtime/compose-client-app.js';
import {
  type AuthStateValue,
  type ClientAnalytics,
  noopClientAnalytics,
  useClientAnalytics,
} from '#runtime/index.js';
import {renderComposedShell} from '#test/render.js';
import {defineRoute} from './define-route.js';

function AnalyticsProbe() {
  const analytics = useClientAnalytics();
  useEffect(() => {
    analytics.capture('probe_event', {source: 'probe'});
  }, [analytics]);
  return <h1>Analytics probe</h1>;
}

function CaptureProbe() {
  const analytics = useClientAnalytics();
  return (
    <button type="button" onClick={() => analytics.capture('probe_event', {source: 'probe'})}>
      Capture analytics
    </button>
  );
}

function analyticsFeature() {
  return defineClientFeature({
    id: 'acme.analytics',
    routes: [
      {path: '/w/$workspaceSlug/analytics', parent: 'workspaceLayout', impl: 'analytics'},
      {path: '/analytics', parent: 'root', impl: 'analytics'},
    ],
  });
}

async function renderAnalyticsProbe(options: {capture?: ClientAnalytics['capture']}) {
  await renderComposedShell({
    features: [analyticsFeature()],
    initialPath: '/w/workspace/analytics',
    resolveImpl: () => defineRoute({staticData: {frame: 'content'}, component: AnalyticsProbe}),
    ...(options.capture ? {clientAnalytics: {capture: options.capture}} : {}),
  });
}

function authenticatedAuth({
  user,
  workspaces,
}: Pick<AuthStateValue, 'user' | 'workspaces'>): AuthStateValue {
  return {
    status: 'authenticated',
    ...(user ? {user} : {}),
    workspaces,
    isLoading: false,
    isAuthenticated: true,
    hasWorkspace: workspaces.length > 0,
  };
}

describe('ClientAnalytics', () => {
  test('supplies fresh user and workspace snapshots across subject lifecycle changes', async () => {
    const capture = vi.fn();
    const initialAuth = authenticatedAuth({
      user: {id: 'user-a', email: 'a@example.test', name: 'User A'},
      workspaces: [
        {id: 'workspace-a', name: 'Workspace A', slug: 'workspace-a', membershipId: 'membership-a'},
        {id: 'workspace-b', name: 'Workspace B', slug: 'workspace-b', membershipId: 'membership-b'},
      ],
    });
    const {router, store} = await renderComposedShell({
      auth: initialAuth,
      features: [analyticsFeature()],
      initialPath: '/w/workspace-a/analytics',
      resolveImpl: () => defineRoute({staticData: {frame: 'content'}, component: CaptureProbe}),
      clientAnalytics: {capture},
    });

    fireEvent.click(await screen.findByRole('button', {name: 'Capture analytics'}));
    expect(capture).toHaveBeenLastCalledWith(
      'probe_event',
      {source: 'probe'},
      {
        user: {id: 'user-a', email: 'a@example.test', name: 'User A'},
        workspace: {id: 'workspace-a', name: 'Workspace A'},
      },
    );

    await act(async () => {
      await (router as {navigate: (options: unknown) => Promise<void>}).navigate({
        to: '/w/$workspaceSlug/analytics',
        params: {workspaceSlug: 'workspace-b'},
      });
    });
    fireEvent.click(screen.getByRole('button', {name: 'Capture analytics'}));
    expect(capture).toHaveBeenLastCalledWith(
      'probe_event',
      {source: 'probe'},
      {
        user: {id: 'user-a', email: 'a@example.test', name: 'User A'},
        workspace: {id: 'workspace-b', name: 'Workspace B'},
      },
    );

    act(() => {
      store.set(
        authStateAtom,
        authenticatedAuth({
          user: {id: 'user-a', email: 'a@example.test', name: 'User A'},
          workspaces: [
            {
              id: 'workspace-b',
              name: 'Renamed workspace',
              slug: 'workspace-b',
              membershipId: 'membership-b',
            },
          ],
        }),
      );
    });
    fireEvent.click(screen.getByRole('button', {name: 'Capture analytics'}));
    expect(capture).toHaveBeenLastCalledWith(
      'probe_event',
      {source: 'probe'},
      {
        user: {id: 'user-a', email: 'a@example.test', name: 'User A'},
        workspace: {id: 'workspace-b', name: 'Renamed workspace'},
      },
    );

    act(() => {
      store.set(
        authStateAtom,
        authenticatedAuth({user: {id: 'user-b', email: 'b@example.test'}, workspaces: []}),
      );
    });
    await act(async () => {
      await (router as {navigate: (options: unknown) => Promise<void>}).navigate({
        to: '/analytics',
      });
    });
    fireEvent.click(screen.getByRole('button', {name: 'Capture analytics'}));
    expect(capture).toHaveBeenLastCalledWith(
      'probe_event',
      {source: 'probe'},
      {
        user: {id: 'user-b', email: 'b@example.test'},
      },
    );

    act(() => {
      store.set(
        authStateAtom,
        authenticatedAuth({
          user: {id: 'user-b', email: 'b@example.test'},
          workspaces: [
            {
              id: 'workspace-b',
              name: 'Renamed workspace',
              slug: 'workspace-b',
              membershipId: 'membership-b',
            },
          ],
        }),
      );
    });
    await act(async () => {
      await (router as {navigate: (options: unknown) => Promise<void>}).navigate({
        to: '/w/$workspaceSlug/analytics',
        params: {workspaceSlug: 'workspace-b'},
      });
    });
    fireEvent.click(screen.getByRole('button', {name: 'Capture analytics'}));
    expect(capture).toHaveBeenLastCalledWith(
      'probe_event',
      {source: 'probe'},
      {
        user: {id: 'user-b', email: 'b@example.test'},
        workspace: {id: 'workspace-b', name: 'Renamed workspace'},
      },
    );

    act(() => {
      store.set(authStateAtom, {status: 'guest'});
    });
    await act(async () => {
      await (router as {navigate: (options: unknown) => Promise<void>}).navigate({
        to: '/analytics',
      });
    });
    fireEvent.click(screen.getByRole('button', {name: 'Capture analytics'}));
    expect(capture).toHaveBeenLastCalledWith('probe_event', {source: 'probe'}, {});
  });

  test('no-op default never throws and discards events', async () => {
    expect(() => noopClientAnalytics.capture('event', {key: 'value'})).not.toThrow();

    await renderAnalyticsProbe({});

    expect(await screen.findByRole('heading', {name: 'Analytics probe'})).toBeVisible();
  });

  test('reaches a composed implementation with event and properties', async () => {
    const capture = vi.fn();
    await renderAnalyticsProbe({capture});

    expect(await screen.findByRole('heading', {name: 'Analytics probe'})).toBeVisible();
    expect(capture).toHaveBeenCalledWith(
      'probe_event',
      {source: 'probe'},
      {
        workspace: {id: 'workspace', name: 'Workspace'},
      },
    );
  });

  test('contains failures from an injected implementation', async () => {
    const capture = vi.fn(() => {
      throw new Error('analytics unavailable');
    });
    await renderAnalyticsProbe({capture});

    expect(await screen.findByRole('heading', {name: 'Analytics probe'})).toBeVisible();
    expect(capture).toHaveBeenCalledWith(
      'probe_event',
      {source: 'probe'},
      {
        workspace: {id: 'workspace', name: 'Workspace'},
      },
    );
  });

  test('contains failures from an asynchronously rejected implementation', async () => {
    const capture = vi.fn(() => Promise.reject(new Error('analytics unavailable asynchronously')));
    await renderAnalyticsProbe({capture});

    expect(await screen.findByRole('heading', {name: 'Analytics probe'})).toBeVisible();
    await act(async () => {
      await Promise.resolve();
    });
    expect(capture).toHaveBeenCalledWith(
      'probe_event',
      {source: 'probe'},
      {
        workspace: {id: 'workspace', name: 'Workspace'},
      },
    );
  });

  test('wires injected analytics through composeClientApp', async () => {
    const capture = vi.fn();
    const dispose = renderComposedApp({capture});

    try {
      expect(await screen.findByRole('heading', {name: 'Analytics probe'})).toBeVisible();
      expect(capture).toHaveBeenCalledWith('probe_event', {source: 'probe'});
    } finally {
      dispose();
    }
  });

  test('uses the no-op analytics implementation when composeClientApp receives none', async () => {
    const dispose = renderComposedApp({});

    try {
      expect(await screen.findByRole('heading', {name: 'Analytics probe'})).toBeVisible();
    } finally {
      dispose();
    }
  });
});

function renderComposedApp(options: {capture?: ClientAnalytics['capture']}): () => void {
  window.__SHIPFOX_CONFIG__ = {API_URL: 'https://api.example.test'};
  const element = document.createElement('div');
  document.body.append(element);
  const rootRoute = createRootRoute({component: AnalyticsProbe});
  const router = createRouter({
    history: createMemoryHistory({initialEntries: ['/']}),
    routeTree: rootRoute,
  });
  const app = composeClientApp({
    features: [],
    router,
    ...(options.capture ? {clientAnalytics: {capture: options.capture}} : {}),
  });

  let unmount!: () => void;
  act(() => {
    unmount = app.mount(element);
  });
  return () => {
    unmount();
    element.remove();
  };
}
