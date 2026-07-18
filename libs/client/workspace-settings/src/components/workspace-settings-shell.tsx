import {useActiveWorkspace} from '@shipfox/client-auth';
import {Header, Text} from '@shipfox/react-ui/typography';
import type {ReactNode} from 'react';

interface WorkspaceSettingsShellProps {
  children: (workspace: ReturnType<typeof useActiveWorkspace>) => ReactNode;
}

export function WorkspaceSettingsShell({children}: WorkspaceSettingsShellProps) {
  const workspace = useActiveWorkspace();

  return (
    <div className="flex w-full flex-col gap-24">
      <header className="flex flex-col gap-6">
        <Header variant="h2">Workspace settings</Header>
        <Text size="sm" className="text-foreground-neutral-muted">
          Configure {workspace.name}.
        </Text>
      </header>

      {children(workspace)}
    </div>
  );
}
