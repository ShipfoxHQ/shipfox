import {WorkspaceVariablesSection} from '@shipfox/client-secrets';
import {WorkspaceSettingsShell} from '#components/workspace-settings-shell.js';

export function VariablesSettingsPage() {
  return (
    <WorkspaceSettingsShell>
      {(workspace) => (
        <div>
          <WorkspaceVariablesSection workspaceId={workspace.id} />
        </div>
      )}
    </WorkspaceSettingsShell>
  );
}
