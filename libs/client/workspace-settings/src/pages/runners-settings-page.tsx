import {WorkspaceRunnerTokensSettingsSection} from '@shipfox/client-runners';
import {WorkspaceSettingsShell} from '#components/workspace-settings-shell.js';

export function RunnersSettingsPage() {
  return (
    <WorkspaceSettingsShell>
      {(workspace) => (
        <div>
          <WorkspaceRunnerTokensSettingsSection workspaceId={workspace.id} />
        </div>
      )}
    </WorkspaceSettingsShell>
  );
}
