import {QueryClient} from '@tanstack/react-query';
import {createMemoryHistory, createRouter, RouterProvider} from '@tanstack/react-router';
import {render} from '@testing-library/react';
import {createStore} from 'jotai';
import {composeRoutes} from '#compose/compose-routes.js';
import type {ClientFeature} from '#contract.js';
import {assembleRouteTree, type ResolveRouteImpl} from '#runtime/assemble-route-tree.js';
import {ShellProviderStack} from '#runtime/provider-stack.js';
import {navigationEntries, settingsEntries} from '#runtime/registries.js';

export async function renderComposedShell({
  features,
  initialPath,
  resolveImpl,
}: {
  features: readonly ClientFeature[];
  initialPath: string;
  resolveImpl: ResolveRouteImpl;
}): Promise<{
  router: unknown;
  queryClient: QueryClient;
  store: ReturnType<typeof createStore>;
}> {
  const routeTree = await assembleRouteTree(composeRoutes(features), {
    resolveImpl,
    navigation: navigationEntries(features),
    settingsSections: settingsEntries(features),
  });
  const queryClient = new QueryClient({defaultOptions: {queries: {retry: false}}});
  const store = createStore();
  const router = createRouter({
    history: createMemoryHistory({initialEntries: [initialPath]}),
    routeTree,
    context: {auth: undefined, queryClient},
  });
  render(
    <ShellProviderStack
      features={features}
      queryClient={queryClient}
      store={store}
      auth={{effects: false}}
    >
      <RouterProvider router={router} />
    </ShellProviderStack>,
  );
  return {router, queryClient, store};
}
