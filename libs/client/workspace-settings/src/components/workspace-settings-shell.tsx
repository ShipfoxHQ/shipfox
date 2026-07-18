import {useActiveWorkspace} from '@shipfox/client-shell/runtime';
import type {ReactNode} from 'react';

interface WorkspaceSettingsShellProps {
  children: (workspace: ReturnType<typeof useActiveWorkspace>) => ReactNode;
}

export function WorkspaceSettingsShell({children}: WorkspaceSettingsShellProps) {
  const workspace = useActiveWorkspace();

  return children(workspace);
}
