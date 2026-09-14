import type {PropsWithChildren} from 'react';
import {createContext, useContext, useLayoutEffect, useMemo, useRef} from 'react';
import type {UserIdentity} from '#core/session.js';
import {useMaybeActiveWorkspace} from './active-workspace.js';
import {useAuthState} from './auth.js';

export interface ClientAnalyticsUser {
  id: string;
  email: string;
  name?: string;
}

export interface ClientAnalyticsWorkspace {
  id: string;
  name: string;
}

/**
 * The authoritative subjects known by the composed client at capture time.
 * This contract deliberately does not depend on an analytics provider.
 */
export interface ClientAnalyticsContext {
  user?: ClientAnalyticsUser;
  workspace?: ClientAnalyticsWorkspace;
}

/**
 * Application-provided UI analytics. Call `capture` from an effect or event
 * handler, not during render. The provider isolates synchronous and
 * asynchronous implementation failures. The optional context argument is
 * additive so existing adapters that accept two arguments remain compatible.
 */
export interface ClientAnalytics {
  capture(
    event: string,
    properties?: Record<string, unknown>,
    context?: ClientAnalyticsContext,
  ): void | PromiseLike<void>;
}

/** Analytics that discards every event; the default for self-hosted builds. */
export const noopClientAnalytics: ClientAnalytics = {
  capture() {
    // UI analytics are optional; the open-source client has no telemetry endpoint.
  },
};

const ClientAnalyticsContext = createContext<ClientAnalytics>(noopClientAnalytics);

export function ClientAnalyticsProvider({
  analytics,
  children,
}: PropsWithChildren<{analytics?: ClientAnalytics}>) {
  const safeAnalytics = useMemo(
    () => (analytics ? createSafeClientAnalytics(analytics) : noopClientAnalytics),
    [analytics],
  );

  return (
    <ClientAnalyticsContext.Provider value={safeAnalytics}>
      {children}
    </ClientAnalyticsContext.Provider>
  );
}

export function useClientAnalytics(): ClientAnalytics {
  return useContext(ClientAnalyticsContext);
}

/**
 * Resolves the current authenticated subjects at the shell route boundary so
 * feature packages do not need to know about authentication or routing.
 */
export function ClientAnalyticsBoundary({children}: PropsWithChildren) {
  const auth = useAuthState();
  const workspace = useMaybeActiveWorkspace();
  const analytics = useClientAnalytics();
  const context = useMemo<ClientAnalyticsContext>(() => {
    const user = auth.isAuthenticated && auth.user ? toClientAnalyticsUser(auth.user) : undefined;
    const activeWorkspace =
      auth.isAuthenticated && workspace ? toClientAnalyticsWorkspace(workspace) : undefined;
    return {
      ...(user ? {user} : {}),
      ...(activeWorkspace ? {workspace: activeWorkspace} : {}),
    };
  }, [auth.isAuthenticated, auth.user, workspace]);
  const latestContext = useRef<ClientAnalyticsContext>(context);
  useLayoutEffect(() => {
    latestContext.current = context;
  }, [context]);
  const contextualAnalytics = useMemo(
    () => createContextualClientAnalytics(analytics, latestContext),
    [analytics],
  );

  return (
    <ClientAnalyticsContext.Provider value={contextualAnalytics}>
      {children}
    </ClientAnalyticsContext.Provider>
  );
}

function toClientAnalyticsUser(user: UserIdentity) {
  return {
    id: user.id,
    email: user.email,
    ...(user.name !== undefined ? {name: user.name} : {}),
  } satisfies ClientAnalyticsUser;
}

function toClientAnalyticsWorkspace(workspace: ClientAnalyticsWorkspace) {
  return {id: workspace.id, name: workspace.name} satisfies ClientAnalyticsWorkspace;
}

function createContextualClientAnalytics(
  analytics: ClientAnalytics,
  latestContext: {current: ClientAnalyticsContext},
): ClientAnalytics {
  return {
    capture(event, properties) {
      return analytics.capture(event, properties, latestContext.current);
    },
  };
}

function createSafeClientAnalytics(analytics: ClientAnalytics): ClientAnalytics {
  return {
    capture(event, properties, context) {
      try {
        const result =
          context === undefined
            ? analytics.capture(event, properties)
            : analytics.capture(event, properties, context);
        void Promise.resolve(result).catch(() => undefined);
      } catch {
        // Optional analytics must not interrupt a feature render or user action.
      }
    },
  };
}
