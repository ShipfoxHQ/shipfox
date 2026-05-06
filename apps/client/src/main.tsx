/// <reference types="@shipfox/vite/client" />

import './styles.css';

import {AuthProvider, useAuthState} from '@shipfox/client-auth';
import {RouterProvider, router} from '@shipfox/client-router';
import {ThemeProvider, Toaster, TooltipProvider} from '@shipfox/react-ui';
import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';

function RoutedApp() {
  const auth = useAuthState();
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
