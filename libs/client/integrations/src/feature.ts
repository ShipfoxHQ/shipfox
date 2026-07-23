import {defineClientFeature, type SettingsSectionEntry} from '@shipfox/client-shell';

export const integrationsSettingsSections = [
  {
    id: 'settings.integrations',
    pathSegment: 'integrations',
    label: 'Integrations',
    icon: 'plugLine',
    order: 700,
  },
] as const satisfies readonly SettingsSectionEntry[];

export const integrationsFeature = defineClientFeature({
  id: 'shipfox.integrations',
  routes: [
    {
      path: '/integrations/github/callback',
      parent: 'root',
      impl: '@shipfox/client-integrations/routes/github-callback',
    },
    {
      path: '/integrations/linear/callback',
      parent: 'root',
      impl: '@shipfox/client-integrations/routes/linear-callback',
    },
    {
      path: '/integrations/sentry/callback',
      parent: 'root',
      impl: '@shipfox/client-integrations/routes/sentry-callback',
    },
    {
      path: '/integrations/slack/callback',
      parent: 'root',
      impl: '@shipfox/client-integrations/routes/slack-callback',
    },
    {
      path: '/workspaces/$wid/integrations',
      parent: 'workspaceLayout',
      impl: '@shipfox/client-integrations/routes/integrations',
    },
    {
      path: '/workspaces/$wid/integrations/gitea',
      parent: 'workspaceLayout',
      impl: '@shipfox/client-integrations/routes/gitea',
    },
    {
      path: '/workspaces/$wid/integrations/github',
      parent: 'workspaceLayout',
      impl: '@shipfox/client-integrations/routes/github',
    },
    {
      path: '/workspaces/$wid/integrations/linear',
      parent: 'workspaceLayout',
      impl: '@shipfox/client-integrations/routes/linear',
    },
    {
      path: '/workspaces/$wid/integrations/sentry',
      parent: 'workspaceLayout',
      impl: '@shipfox/client-integrations/routes/sentry',
    },
    {
      path: '/workspaces/$wid/integrations/slack',
      parent: 'workspaceLayout',
      impl: '@shipfox/client-integrations/routes/slack',
    },
    {
      path: '/workspaces/$wid/settings/integrations',
      parent: 'workspaceSettings',
      impl: '@shipfox/client-integrations/routes/integrations-settings',
    },
  ],
  settingsSections: integrationsSettingsSections,
});
