import {configureApiClient} from '@shipfox/client-api';
import {
  ConfigErrorScreen,
  getWindowRuntimeConfig,
  loadConfig,
  setLoadedConfig,
} from '@shipfox/client-config';
import {ThemeProvider} from '@shipfox/react-ui/theme';
import {Toaster} from '@shipfox/react-ui/toast';
import {TooltipProvider} from '@shipfox/react-ui/tooltip';
import {QueryClient} from '@tanstack/react-query';
import {type AnyRouter, RouterProvider} from '@tanstack/react-router';
import {createStore} from 'jotai';
import {StrictMode, useEffect} from 'react';
import {createRoot} from 'react-dom/client';
import {composeRoutes} from '#compose/compose-routes.js';
import {mergeConfigShapes} from '#compose/merge-config.js';
import {validateProviderIds} from '#compose/validate-providers.js';
import {validateNavigation, validateSettingsSections} from '#compose/validate-registries.js';
import type {ClientFeature} from '#contract.js';
import {useAuthState} from './auth.js';
import {ChromeProvider, type ChromeSlots} from './chrome-context.js';
import {ShellProviderStack} from './provider-stack.js';
import type {WorkspaceSetupGate} from './workspace-setup.js';

export function composeClientApp({
  features,
  router,
  chrome,
  workspaceSetup,
}: {
  features: readonly ClientFeature[];
  router: AnyRouter;
  chrome?: ChromeSlots;
  workspaceSetup?: WorkspaceSetupGate;
}) {
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
    mount(element: HTMLElement): void {
      const root = createRoot(element);
      if (!config.ok) {
        root.render(
          <StrictMode>
            <ThemeProvider>
              <TooltipProvider>
                <ConfigErrorScreen errors={config.errors} />
              </TooltipProvider>
            </ThemeProvider>
          </StrictMode>,
        );
        return;
      }

      configureApiClient({baseUrl: configApiUrl(config.config)});
      const queryClient = new QueryClient();
      root.render(
        <StrictMode>
          <ChromeProvider chrome={chrome}>
            <ShellProviderStack features={features} queryClient={queryClient} store={createStore()}>
              <RoutedApp
                router={router}
                queryClient={queryClient}
                workspaceSetup={workspaceSetup}
              />
              <Toaster />
            </ShellProviderStack>
          </ChromeProvider>
        </StrictMode>,
      );
    },
  };
}

function RoutedApp({
  router,
  queryClient,
  workspaceSetup,
}: {
  router: AnyRouter;
  queryClient: QueryClient;
  workspaceSetup: WorkspaceSetupGate | undefined;
}) {
  const auth = useAuthState();

  useEffect(() => {
    if (!auth.isLoading) router.invalidate();
  }, [auth.isLoading, router]);

  return (
    <RouterProvider
      router={router as never}
      context={{auth, queryClient, workspaceSetup} as never}
    />
  );
}

function configApiUrl(config: unknown): string {
  if (
    typeof config !== 'object' ||
    config === null ||
    !('apiUrl' in config) ||
    typeof config.apiUrl !== 'string'
  ) {
    throw new Error('Composed client configuration must include a string apiUrl.');
  }
  return config.apiUrl;
}
