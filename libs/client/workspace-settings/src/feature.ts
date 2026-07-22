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
  ],
});
