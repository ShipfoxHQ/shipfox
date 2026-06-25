import {WorkspaceMembersSettingsSection} from '#components/members/workspace-members-section.js';
import {WorkspaceSettingsShell} from '#components/workspace-settings-shell.js';

export function MembersSettingsPage() {
  return (
    <WorkspaceSettingsShell>
      {(workspace) => (
        <div>
          <WorkspaceMembersSettingsSection
            workspaceId={workspace.id}
            workspaceName={workspace.name}
          />
        </div>
      )}
    </WorkspaceSettingsShell>
  );
}
