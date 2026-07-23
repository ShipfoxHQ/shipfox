import {defineClientFeature, type SettingsSectionEntry} from '@shipfox/client-shell';

export const secretsSettingsSections = [
  {id: 'settings.secrets', pathSegment: 'secrets', label: 'Secrets', icon: 'keyLine', order: 500},
  {
    id: 'settings.variables',
    pathSegment: 'variables',
    label: 'Variables',
    icon: 'bracesLine',
    order: 600,
  },
] as const satisfies readonly SettingsSectionEntry[];

export const secretsFeature = defineClientFeature({
  id: 'shipfox.secrets',
  routes: [
    {
      path: '/workspaces/$wid/settings/secrets',
      parent: 'workspaceSettings',
      impl: '@shipfox/client-secrets/routes/secrets-settings',
    },
    {
      path: '/workspaces/$wid/settings/variables',
      parent: 'workspaceSettings',
      impl: '@shipfox/client-secrets/routes/variables-settings',
    },
  ],
  settingsSections: secretsSettingsSections,
});
