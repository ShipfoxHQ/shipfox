import {AuthGuard, WorkspaceGuard} from '@shipfox/client-auth';
import {IntegrationGalleryPage} from '@shipfox/client-integrations';
import {createFileRoute} from '@tanstack/react-router';

export const Route = createFileRoute('/setup/integrations')({
  component: () => (
    <AuthGuard>
      <WorkspaceGuard>
        <IntegrationGalleryPage />
      </WorkspaceGuard>
    </AuthGuard>
  ),
});
