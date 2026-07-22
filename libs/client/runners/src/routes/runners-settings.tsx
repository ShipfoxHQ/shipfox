import {defineRoute, useActiveWorkspace} from '@shipfox/client-shell/runtime';
import {WorkspaceManualRegistrationTokensSettingsSection} from '#index.js';

export default defineRoute({
  component: () => (
    <WorkspaceManualRegistrationTokensSettingsSection workspaceId={useActiveWorkspace().id} />
  ),
});
