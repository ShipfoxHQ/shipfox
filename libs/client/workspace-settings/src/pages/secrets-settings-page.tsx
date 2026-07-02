import {WorkspaceSecretsSection} from '@shipfox/client-secrets';
import {WorkspaceSettingsShell} from '#components/workspace-settings-shell.js';

export function SecretsSettingsPage() {
  return (
    <WorkspaceSettingsShell>
      {(workspace) => (
        <div>
          <WorkspaceSecretsSection workspaceId={workspace.id} />
        </div>
      )}
    </WorkspaceSettingsShell>
  );
}
