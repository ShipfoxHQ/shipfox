import {
  ConfigErrorScreen,
  getWindowRuntimeConfig,
  loadConfig,
  setLoadedConfig,
} from '@shipfox/client-config';
import {mergeConfigShapes} from '@shipfox/client-shell';
import {ShellProviders} from '@shipfox/client-shell/testing';
import {RouterProvider} from '@tanstack/react-router';
import {createRoot} from 'react-dom/client';
import {features} from './features.js';
import {router} from './shipfox-app.gen.js';

export function ClientApp() {
  const config = loadConfig(mergeConfigShapes(features), {
    runtime: getWindowRuntimeConfig(),
    build: import.meta.env,
  });
  if (!config.ok) return <ConfigErrorScreen errors={config.errors} />;
  setLoadedConfig(config.config);
  return (
    <ShellProviders features={features}>
      <RouterProvider router={router} />
    </ShellProviders>
  );
}

const root = document.getElementById('root');
if (root) createRoot(root).render(<ClientApp />);
