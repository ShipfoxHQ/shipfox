import {defineClientFeature} from '@shipfox/client-shell';

export const agentFeature = defineClientFeature({
  id: 'shipfox.agent',
  routes: [
    {
      path: '/workspaces/$wid/model-provider',
      parent: 'workspaceLayout',
      impl: '@shipfox/client-agent/routes/model-provider',
    },
    {
      path: '/workspaces/$wid/settings/agents',
      parent: 'workspaceSettings',
      impl: '@shipfox/client-agent/routes/agents-settings',
    },
  ],
  settingsSections: [
    {
      id: 'settings.agents',
      pathSegment: 'agents',
      label: 'Agents',
      icon: 'robot2Line',
      order: 400,
    },
  ],
});
