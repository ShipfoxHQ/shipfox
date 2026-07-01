import {WorkspaceManualRegistrationTokensSettingsSection} from '@shipfox/client-runners';
import {WorkspaceSettingsShell} from '#components/workspace-settings-shell.js';

export function RunnersSettingsPage() {
  return (
    <WorkspaceSettingsShell>
      {(workspace) => (
        <div>
          <WorkspaceManualRegistrationTokensSettingsSection workspaceId={workspace.id} />
        </div>
      )}
    </WorkspaceSettingsShell>
  );
}
