import {WorkspaceProvisionerTokensSettingsSection} from '@shipfox/client-runners';
import {WorkspaceSettingsShell} from '#components/workspace-settings-shell.js';

export function ProvisionersSettingsPage() {
  return (
    <WorkspaceSettingsShell>
      {(workspace) => (
        <div>
          <WorkspaceProvisionerTokensSettingsSection workspaceId={workspace.id} />
        </div>
      )}
    </WorkspaceSettingsShell>
  );
}
