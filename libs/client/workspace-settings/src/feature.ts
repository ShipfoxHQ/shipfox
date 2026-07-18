import {defineClientFeature} from '@shipfox/client-shell';
import type {IconName} from '@shipfox/react-ui/icon';

export const workspaceSettingsFeature = defineClientFeature({
  id: 'shipfox.workspace-settings',
  routes: [
    {
      path: '/workspaces/$wid/settings',
      parent: 'workspaceSettings',
      impl: '@shipfox/client-workspace-settings/routes/index',
    },
    {
      path: '/workspaces/$wid/settings/members',
      parent: 'workspaceSettings',
      impl: '@shipfox/client-workspace-settings/routes/members',
    },
    {
      path: '/workspaces/$wid/settings/runners',
      parent: 'workspaceSettings',
      impl: '@shipfox/client-workspace-settings/routes/runners',
    },
    {
      path: '/workspaces/$wid/settings/provisioners',
      parent: 'workspaceSettings',
      impl: '@shipfox/client-workspace-settings/routes/provisioners',
    },
    {
      path: '/workspaces/$wid/settings/agents',
      parent: 'workspaceSettings',
      impl: '@shipfox/client-workspace-settings/routes/agents',
    },
    {
      path: '/workspaces/$wid/settings/secrets',
      parent: 'workspaceSettings',
      impl: '@shipfox/client-workspace-settings/routes/secrets',
    },
    {
      path: '/workspaces/$wid/settings/variables',
      parent: 'workspaceSettings',
      impl: '@shipfox/client-workspace-settings/routes/variables',
    },
    {
      path: '/workspaces/$wid/settings/integrations',
      parent: 'workspaceSettings',
      impl: '@shipfox/client-workspace-settings/routes/integrations',
    },
    {
      path: '/workspaces/$wid/settings/events',
      parent: 'workspaceSettings',
      impl: '@shipfox/client-workspace-settings/routes/events',
    },
  ],
  navigation: [
    {
      id: 'nav.settings',
      scope: 'workspace',
      label: 'Settings',
      to: '/workspaces/$wid/settings',
      order: 200,
    },
  ],
  settingsSections: [
    {
      id: 'settings.members',
      pathSegment: 'members',
      label: 'Members',
      icon: 'userLine' as IconName,
      order: 100,
    },
    {
      id: 'settings.runners',
      pathSegment: 'runners',
      label: 'Runners',
      icon: 'settings3Line' as IconName,
      order: 200,
    },
    {
      id: 'settings.provisioners',
      pathSegment: 'provisioners',
      label: 'Runner provisioners',
      icon: 'serverLine' as IconName,
      order: 300,
    },
    {
      id: 'settings.agents',
      pathSegment: 'agents',
      label: 'Agents',
      icon: 'robot2Line' as IconName,
      order: 400,
    },
    {
      id: 'settings.secrets',
      pathSegment: 'secrets',
      label: 'Secrets',
      icon: 'keyLine' as IconName,
      order: 500,
    },
    {
      id: 'settings.variables',
      pathSegment: 'variables',
      label: 'Variables',
      icon: 'bracesLine' as IconName,
      order: 600,
    },
    {
      id: 'settings.integrations',
      pathSegment: 'integrations',
      label: 'Integrations',
      icon: 'plugLine' as IconName,
      order: 700,
    },
    {
      id: 'settings.events',
      pathSegment: 'events',
      label: 'Events',
      icon: 'pulseLine' as IconName,
      order: 800,
    },
  ],
});
