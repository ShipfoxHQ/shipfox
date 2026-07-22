import {createRunnersModule} from '@shipfox/api-runners';
import {createServer, defaultModules} from '@shipfox/api-server';

void createServer({
  modules: [
    ...(await defaultModules({
      runnersModule: ({auth}) =>
        createRunnersModule({
          auth,
          installationProvisioning: {
            policy: {
              filterEligibleWorkspaceIds: async (workspaceIds) => new Set(workspaceIds),
            },
          },
        }),
    })),
    {name: 'external-dummy'},
  ],
});
