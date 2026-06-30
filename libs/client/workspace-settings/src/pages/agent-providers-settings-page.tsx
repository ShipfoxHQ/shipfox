import {WorkspaceAgentProvidersSection} from '@shipfox/client-agent';
import {WorkspaceSettingsShell} from '#components/workspace-settings-shell.js';

export function AgentProvidersSettingsPage() {
  return (
    <WorkspaceSettingsShell>
      {(workspace) => (
        <div>
          <WorkspaceAgentProvidersSection workspaceId={workspace.id} />
        </div>
      )}
    </WorkspaceSettingsShell>
  );
}
