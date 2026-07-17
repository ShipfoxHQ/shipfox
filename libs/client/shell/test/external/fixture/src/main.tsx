import {
  ConfigErrorScreen,
  getWindowRuntimeConfig,
  loadConfig,
} from '@shipfox/client-config';
import {mergeConfigShapes} from '@shipfox/client-shell/runtime';
import {ShellProviders} from '@shipfox/client-shell/testing';
import {
  type ProviderProbeEntry,
  ProviderProbeObserver,
} from '@shipfox/client-shell-fixture-feature';
import {RouterProvider} from '@tanstack/react-router';
import {createRoot} from 'react-dom/client';
import {features} from './features.js';
import {router} from './shipfox-app.gen.js';

export function createClientAppElement({
  onProviders,
}: {
  onProviders?: (entries: readonly ProviderProbeEntry[]) => void;
} = {}) {
  const config = loadConfig(mergeConfigShapes(features), {
    runtime: getWindowRuntimeConfig(),
    build: import.meta.env,
  });
  if (!config.ok) return <ConfigErrorScreen errors={config.errors} />;
  return (
    <ShellProviders features={features} config={config.config}>
      {onProviders ? <ProviderProbeObserver onChange={onProviders} /> : null}
      <RouterProvider router={router} />
    </ShellProviders>
  );
}

const root = document.getElementById('root');
if (root) createRoot(root).render(createClientAppElement());
