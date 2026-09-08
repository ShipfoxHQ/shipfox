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
import type {QueryClient} from '@tanstack/react-query';
import {type AnyRouter, RouterProvider} from '@tanstack/react-router';
import {createStore} from 'jotai';
import {StrictMode, useEffect} from 'react';
import {createRoot} from 'react-dom/client';
import {composeClientFeatures} from '#compose/compose-client-features.js';
import type {ClientFeature} from '#contract.js';
import {type AuthRuntimeProps, useAuthState} from './auth.js';
import {ChromeProvider, type ChromeSlots} from './chrome-context.js';
import {type ClientAnalytics, ClientAnalyticsProvider} from './client-analytics.js';
import {type ClientUsagePricing, ClientUsagePricingProvider} from './client-usage-pricing.js';
import {ShellProviderStack} from './provider-stack.js';
import {createShellQueryClient} from './query-client.js';
import type {WorkspaceSetupGate} from './workspace-setup.js';

export function composeClientApp({
  features,
  router,
  chrome,
  workspaceSetup,
  clientAnalytics,
  usagePricing,
  auth,
}: {
  features: readonly ClientFeature[];
  router: AnyRouter;
  chrome?: ChromeSlots;
  workspaceSetup?: WorkspaceSetupGate;
  clientAnalytics?: ClientAnalytics;
  usagePricing?: ClientUsagePricing;
  auth?: Pick<
    AuthRuntimeProps,
    'effects' | 'bootRestorer' | 'boot' | 'restoreAdoptedSession' | 'adoptedSessionRestorer'
  >;
}) {
  const composition = composeClientFeatures(features);
  const config = loadConfig(composition.configShape, {
    runtime: getWindowRuntimeConfig(),
    build: (import.meta as ImportMeta & {env?: Record<string, unknown>}).env,
  });
  if (config.ok) setLoadedConfig(config.config);

  return {
    mount(element: HTMLElement): () => void {
      const root = createRoot(element);
      const unmount = () => root.unmount();
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
        return unmount;
      }

      configureApiClient({baseUrl: configApiUrl(config.config)});
      const queryClient = createShellQueryClient();
      root.render(
        <StrictMode>
          <ChromeProvider chrome={chrome}>
            <ClientAnalyticsProvider {...(clientAnalytics ? {analytics: clientAnalytics} : {})}>
              <ClientUsagePricingProvider {...(usagePricing ? {usagePricing} : {})}>
                <ShellProviderStack
                  features={features}
                  queryClient={queryClient}
                  store={createStore()}
                  {...(auth ? {auth} : {})}
                >
                  <RoutedApp
                    router={router}
                    queryClient={queryClient}
                    workspaceSetup={workspaceSetup}
                    projectSlugResolver={chrome?.projectSlugResolver}
                    unresolvedWorkspaceAvailable={Boolean(chrome?.UnresolvedWorkspace)}
                  />
                  <Toaster />
                </ShellProviderStack>
              </ClientUsagePricingProvider>
            </ClientAnalyticsProvider>
          </ChromeProvider>
        </StrictMode>,
      );
      return unmount;
    },
  };
}

function RoutedApp({
  router,
  queryClient,
  workspaceSetup,
  projectSlugResolver,
  unresolvedWorkspaceAvailable,
}: {
  router: AnyRouter;
  queryClient: QueryClient;
  workspaceSetup: WorkspaceSetupGate | undefined;
  projectSlugResolver: ChromeSlots['projectSlugResolver'] | undefined;
  unresolvedWorkspaceAvailable: boolean;
}) {
  const auth = useAuthState();

  useEffect(() => {
    if (!auth.isLoading && auth.routeRevision !== undefined) router.invalidate();
  }, [auth.isLoading, auth.routeRevision, router]);

  return (
    <RouterProvider
      router={router as never}
      context={
        {
          auth,
          queryClient,
          workspaceSetup,
          projectSlugResolver,
          unresolvedWorkspaceAvailable,
        } as never
      }
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
