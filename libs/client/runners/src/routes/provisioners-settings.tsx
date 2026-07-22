import {defineRoute, useActiveWorkspace} from '@shipfox/client-shell/runtime';
import {WorkspaceProvisionerTokensSettingsSection} from '#index.js';

export default defineRoute({
  component: () => (
    <WorkspaceProvisionerTokensSettingsSection workspaceId={useActiveWorkspace().id} />
  ),
});
