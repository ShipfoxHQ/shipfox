import {useActiveWorkspace} from '@shipfox/client-auth';
import {Header, Text} from '@shipfox/react-ui';
import {WorkspaceMembersSettingsSection} from '#components/members/workspace-members-section.js';
import {SettingsNav} from '#components/settings-nav.js';

export function MembersSettingsPage() {
  const workspace = useActiveWorkspace();

  return (
    <div className="flex w-full flex-col gap-24">
      <header className="flex flex-col gap-6">
        <Header variant="h2">Workspace settings</Header>
        <Text size="sm" className="text-foreground-neutral-muted">
          Configure {workspace.name}.
        </Text>
      </header>

      <div className="grid grid-cols-[180px_minmax(0,1fr)] gap-32 max-[760px]:grid-cols-1">
        <SettingsNav workspaceId={workspace.id} />
        <div>
          <WorkspaceMembersSettingsSection
            workspaceId={workspace.id}
            workspaceName={workspace.name}
          />
        </div>
      </div>
    </div>
  );
}
