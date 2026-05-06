import type {AuthStateValue} from '@shipfox/client-auth';
import {createRouter, type RouteIds} from '@tanstack/react-router';
import {routeTree} from './routeTree.gen.js';

export interface RouterContext {
  /**
   * Auth state pushed in by `<AuthProviderContent>` once auth resolves.
   * `undefined` while auth is still loading on first paint; route `beforeLoad`
   * handlers must short-circuit (return) when this is undefined or
   * `auth.status === 'loading'` so the route waits for auth before deciding.
   */
  auth: AuthStateValue | undefined;
}

export const router = createRouter({
  routeTree,
  scrollRestoration: true,
  context: {auth: undefined} satisfies RouterContext,
});

export type RouterType = typeof router;
export type RouterIds = RouteIds<RouterType['routeTree']>;
