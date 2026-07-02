/// <reference types="@shipfox/vite/client" />

import './styles.css';

import {configureApiClient} from '@shipfox/client-api';
import {AuthProvider, useAuthState} from '@shipfox/client-auth';
import {ConfigErrorScreen, setLoadedConfig} from '@shipfox/client-config';
import {RouterProvider, router} from '@shipfox/client-router';
import {ThemeProvider} from '@shipfox/react-ui/theme';
import {Toaster} from '@shipfox/react-ui/toast';
import {TooltipProvider} from '@shipfox/react-ui/tooltip';
import {QueryClient} from '@tanstack/react-query';
import {StrictMode, useEffect} from 'react';
import {createRoot} from 'react-dom/client';
import {loadAppConfig} from './config.js';

const queryClient = new QueryClient();

function RoutedApp() {
  const auth = useAuthState();

  // Force the router to re-evaluate `beforeLoad` when auth transitions from
  // loading → authenticated/guest. Without this, the initial route match
  // settles while auth is still loading and the redirect never fires.
  useEffect(() => {
    if (!auth.isLoading) {
      router.invalidate();
    }
  }, [auth.isLoading]);

  return <RouterProvider router={router} context={{auth, queryClient}} />;
}

const element = document.getElementById('app');
if (!element) throw new Error('No element with id "app" found');

const root = createRoot(element);
const configResult = loadAppConfig();

// Validate the runtime config before mounting the app. A misconfigured
// self-host deployment gets a precise error screen rather than a blank page or
// a cryptic failed request later.
if (!configResult.ok) {
  root.render(
    <StrictMode>
      <ThemeProvider>
        <ConfigErrorScreen errors={configResult.errors} />
      </ThemeProvider>
    </StrictMode>,
  );
} else {
  setLoadedConfig(configResult.config);
  configureApiClient({baseUrl: configResult.config.apiUrl});

  root.render(
    <StrictMode>
      <ThemeProvider>
        <TooltipProvider>
          <AuthProvider queryClient={queryClient}>
            <RoutedApp />
            <Toaster />
          </AuthProvider>
        </TooltipProvider>
      </ThemeProvider>
    </StrictMode>,
  );
}
