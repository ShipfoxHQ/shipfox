import {WorkspaceModelProvidersSection} from '@shipfox/client-agent';
import {WorkspaceSettingsShell} from '#components/workspace-settings-shell.js';

export function ModelProvidersSettingsPage() {
  return (
    <WorkspaceSettingsShell>
      {(workspace) => (
        <div>
          <WorkspaceModelProvidersSection workspaceId={workspace.id} />
        </div>
      )}
    </WorkspaceSettingsShell>
  );
}
