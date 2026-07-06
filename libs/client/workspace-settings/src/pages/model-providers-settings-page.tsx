import {WorkspaceHarnessesSection, WorkspaceModelProvidersSection} from '@shipfox/client-agent';
import {WorkspaceSettingsShell} from '#components/workspace-settings-shell.js';

export function ModelProvidersSettingsPage() {
  return (
    <WorkspaceSettingsShell>
      {(workspace) => (
        <div className="flex flex-col gap-32">
          <WorkspaceHarnessesSection workspaceId={workspace.id} />
          <WorkspaceModelProvidersSection workspaceId={workspace.id} />
        </div>
      )}
    </WorkspaceSettingsShell>
  );
}
