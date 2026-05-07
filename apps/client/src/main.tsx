/// <reference types="@shipfox/vite/client" />

import './styles.css';

import {AuthProvider, useAuthState} from '@shipfox/client-auth';
import {RouterProvider, router} from '@shipfox/client-router';
import {ThemeProvider, Toaster, TooltipProvider} from '@shipfox/react-ui';
import {StrictMode, useEffect} from 'react';
import {createRoot} from 'react-dom/client';

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

  return <RouterProvider router={router} context={{auth}} />;
}

const element = document.getElementById('app');
if (!element) throw new Error('No element with id "app" found');

createRoot(element).render(
  <StrictMode>
    <ThemeProvider>
      <TooltipProvider>
        <AuthProvider>
          <RoutedApp />
          <Toaster />
        </AuthProvider>
      </TooltipProvider>
    </ThemeProvider>
  </StrictMode>,
);
