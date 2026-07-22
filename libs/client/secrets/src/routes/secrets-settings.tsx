import {defineRoute, useActiveWorkspace} from '@shipfox/client-shell/runtime';
import {WorkspaceSecretsSection} from '#index.js';

export default defineRoute({
  component: () => <WorkspaceSecretsSection workspaceId={useActiveWorkspace().id} />,
});
