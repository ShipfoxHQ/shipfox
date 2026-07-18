import {defineClientFeature} from '@shipfox/client-shell';

export const agentFeature = defineClientFeature({
  id: 'shipfox.agent',
  routes: [
    {
      path: '/workspaces/$wid/model-provider',
      parent: 'workspaceLayout',
      impl: '@shipfox/client-agent/routes/model-provider',
    },
  ],
});
