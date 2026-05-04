import {AuthGuard, WorkspaceGuard} from '@shipfox/client-auth';
import {GithubInstallPage} from '@shipfox/client-integrations';
import {createFileRoute} from '@tanstack/react-router';

export const Route = createFileRoute('/setup/integrations/github')({
  component: () => (
    <AuthGuard>
      <WorkspaceGuard>
        <GithubInstallPage />
      </WorkspaceGuard>
    </AuthGuard>
  ),
});
