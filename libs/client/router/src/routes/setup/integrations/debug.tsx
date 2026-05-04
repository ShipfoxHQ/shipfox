import {AuthGuard, WorkspaceGuard} from '@shipfox/client-auth';
import {DebugInstallPage} from '@shipfox/client-integrations';
import {createFileRoute} from '@tanstack/react-router';

export const Route = createFileRoute('/setup/integrations/debug')({
  component: () => (
    <AuthGuard>
      <WorkspaceGuard>
        <DebugInstallPage />
      </WorkspaceGuard>
    </AuthGuard>
  ),
});
