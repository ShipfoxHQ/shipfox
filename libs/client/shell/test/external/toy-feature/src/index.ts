import {defineClientFeature} from '@shipfox/client-shell';
import {toyConfigShape} from './config.js';
import {ToyFeatureProvider} from './provider.js';

export {
  ProviderProbe,
  type ProviderProbeEntry,
  ProviderProbeObserver,
} from './provider.js';

export const toyFeature = defineClientFeature({
  id: 'fixture.toy-feature',
  routes: [
    {
      path: '/workspaces/$wid/insights',
      parent: 'workspaceLayout',
      impl: '@shipfox/client-shell-fixture-feature/routes/insights',
    },
    {
      path: '/workspaces/$wid/settings/primary',
      parent: 'workspaceSettings',
      impl: '@shipfox/client-shell-fixture-feature/routes/settings',
    },
    {
      path: '/workspaces/$wid/settings/secondary',
      parent: 'workspaceSettings',
      impl: '@shipfox/client-shell-fixture-feature/routes/settings',
    },
  ],
  providers: [{id: 'fixture-toy-provider', Component: ToyFeatureProvider}],
  navigation: [
    {
      id: 'fixture-insights-first',
      scope: 'workspace',
      label: 'Insights first',
      to: '/workspaces/$wid/insights',
      order: 100,
    },
    {
      id: 'fixture-insights-second',
      scope: 'workspace',
      label: 'Insights second',
      to: '/workspaces/$wid/insights',
      order: 200,
    },
  ],
  settingsSections: [
    {
      id: 'fixture-primary-settings',
      pathSegment: 'primary',
      label: 'Primary settings',
      icon: 'userLine',
      order: 100,
    },
    {
      id: 'fixture-secondary-settings',
      pathSegment: 'secondary',
      label: 'Secondary settings',
      icon: 'settings3Line',
      order: 200,
    },
  ],
  configShape: toyConfigShape,
});
