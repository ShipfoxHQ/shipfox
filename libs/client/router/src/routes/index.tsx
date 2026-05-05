import {AuthGuard, WorkspaceGuard} from '@shipfox/client-auth';
import {HomeRouter} from '@shipfox/client-projects';
import {createFileRoute} from '@tanstack/react-router';

export const Route = createFileRoute('/')({
  component: () => (
    <AuthGuard>
      <WorkspaceGuard>
        <HomeRouter />
      </WorkspaceGuard>
    </AuthGuard>
  ),
});
