import {defineClientFeature} from '@shipfox/client-shell';

export const triggersFeature = defineClientFeature({
  id: 'shipfox.triggers',
  routes: [
    {
      path: '/workspaces/$wid/settings/events',
      parent: 'workspaceSettings',
      impl: '@shipfox/client-triggers/routes/events-settings',
    },
  ],
  settingsSections: [
    {id: 'settings.events', pathSegment: 'events', label: 'Events', icon: 'pulseLine', order: 800},
  ],
});
