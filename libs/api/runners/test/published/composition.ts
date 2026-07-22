import type {AuthInterModuleClient} from '@shipfox/api-auth-dto/inter-module';
import {createRunnersModule} from '@shipfox/api-runners';

const auth = {} as AuthInterModuleClient;
const module = createRunnersModule({
  auth,
  installationProvisioning: {
    policy: {
      filterEligibleWorkspaceIds: async (workspaceIds) => new Set(workspaceIds),
    },
  },
});

void module;
