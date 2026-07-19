import {defaultFeatures} from '@shipfox/client-features';
import {defineClientFeature} from '@shipfox/client-shell';
import {z} from 'zod';
import {ExternalProviderInner, ExternalProviderOuter} from './provider';

export const externalConfigShape = {
  externalGreeting: z.string(),
};

export const externalFeature = defineClientFeature({
  id: 'fixture.external',
  routes: [
    {
      path: '/auth/login',
      parent: 'root',
      override: true,
      impl: './features/login-override',
    },
    {
      path: '/workspaces/$wid/settings/external',
      parent: 'workspaceSettings',
      impl: './features/external-settings',
    },
  ],
  providers: [
    {id: 'fixture-provider-outer', Component: ExternalProviderOuter},
    {id: 'fixture-provider-inner', Component: ExternalProviderInner},
  ],
  navigation: [
    {
      id: 'nav.external',
      scope: 'workspace',
      label: 'External',
      to: '/workspaces/$wid/settings/external',
      order: 150,
    },
  ],
  settingsSections: [
    {
      id: 'settings.external',
      pathSegment: 'external',
      label: 'External',
      icon: 'settings3Line',
      order: 150,
    },
  ],
  configShape: externalConfigShape,
});

export const features = [...defaultFeatures(), externalFeature];
