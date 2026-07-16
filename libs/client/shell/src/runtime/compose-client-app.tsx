import {
  ConfigErrorScreen,
  getWindowRuntimeConfig,
  loadConfig,
  setLoadedConfig,
} from '@shipfox/client-config';
import {Toaster} from '@shipfox/react-ui/toast';
import {QueryClient} from '@tanstack/react-query';
import {createRouter, RouterProvider} from '@tanstack/react-router';
import {createStore} from 'jotai';
import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import {composeRoutes} from '#compose/compose-routes.js';
import {mergeConfigShapes} from '#compose/merge-config.js';
import {validateProviderIds} from '#compose/validate-providers.js';
import {validateNavigation, validateSettingsSections} from '#compose/validate-registries.js';
import type {ClientFeature} from '#contract.js';
import {assembleRouteTree} from './assemble-route-tree.js';
import {authStub} from './auth-stub.js';
import type {RouteImpl} from './define-route.js';
import {ShellProviderStack} from './provider-stack.js';
import {navigationEntries, settingsEntries} from './registries.js';

export function composeClientApp({features}: {features: readonly ClientFeature[]}) {
  const routes = composeRoutes(features);
  validateProviderIds(features);
  validateNavigation(
    features,
    routes.map((route) => route.path),
  );
  validateSettingsSections(
    features,
    routes.map((route) => route.path),
  );
  const config = loadConfig(mergeConfigShapes(features), {
    runtime: getWindowRuntimeConfig(),
    build: (import.meta as ImportMeta & {env?: Record<string, unknown>}).env,
  });
  if (config.ok) setLoadedConfig(config.config);

  return {
    async mount(element: HTMLElement): Promise<void> {
      const root = createRoot(element);
      if (!config.ok) {
        root.render(
          <StrictMode>
            <ShellProviderStack features={[]} queryClient={new QueryClient()} store={createStore()}>
              <ConfigErrorScreen errors={config.errors} />
            </ShellProviderStack>
          </StrictMode>,
        );
        return;
      }
      const routeTree = await assembleRouteTree(routes, {
        resolveImpl: resolveDynamicRouteImpl,
        navigation: navigationEntries(features),
        settingsSections: settingsEntries(features),
      });
      const queryClient = new QueryClient();
      const router = createRouter({routeTree, context: {auth: authStub, queryClient}});
      root.render(
        <StrictMode>
          <ShellProviderStack features={features} queryClient={queryClient} store={createStore()}>
            <RouterProvider router={router} />
            <Toaster />
          </ShellProviderStack>
        </StrictMode>,
      );
    },
  };
}

async function resolveDynamicRouteImpl(specifier: string): Promise<RouteImpl> {
  const module = await import(specifier);
  const implementation = module.default ?? module.Route;
  if (implementation && typeof implementation === 'object' && 'options' in implementation) {
    return implementation as RouteImpl;
  }
  throw new Error(
    `Route implementation module "${specifier}" must export a default RouteImpl or Route.`,
  );
}
