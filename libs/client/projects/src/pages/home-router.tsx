import {ApiError} from '@shipfox/client-api';
import {useAuthState, useMaybeActiveWorkspace} from '@shipfox/client-auth';
import {useSourceConnectionsQuery} from '@shipfox/client-integrations';
import {Alert, Button, FullPageLoader, Header, Text} from '@shipfox/react-ui';
import {Navigate} from '@tanstack/react-router';
import {useProjectsInfiniteQuery} from '#hooks/api/projects.js';
import {ProjectsHubPage} from '#pages/projects-hub-page.js';

export function HomeRouter() {
  const auth = useAuthState();
  const activeWorkspace = useMaybeActiveWorkspace();
  const workspace = activeWorkspace ?? auth.workspaces[0];

  const connectionsQuery = useSourceConnectionsQuery(workspace?.id);
  const projectsQuery = useProjectsInfiniteQuery(workspace?.id);

  if (connectionsQuery.isPending || projectsQuery.isPending) {
    return <FullPageLoader />;
  }

  if (connectionsQuery.isError) {
    return (
      <main className="min-h-screen bg-background-subtle-base px-24 py-32 max-[520px]:px-16">
        <div className="mx-auto flex w-full max-w-[1120px] flex-col gap-24">
          <Header variant="h1">Projects</Header>
          <Alert variant="error">
            <div className="flex flex-col gap-8">
              <Text size="sm" bold>
                Could not load integrations
              </Text>
              <Text size="sm">
                {connectionsQuery.error instanceof ApiError
                  ? connectionsQuery.error.message
                  : 'Try again in a moment.'}
              </Text>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => connectionsQuery.refetch()}
                className="w-fit"
              >
                Retry
              </Button>
            </div>
          </Alert>
        </div>
      </main>
    );
  }

  const connections = connectionsQuery.data?.connections ?? [];
  const projects = projectsQuery.data?.pages.flatMap((page) => page.projects) ?? [];

  if (connections.length === 0) {
    return <Navigate to="/setup/integrations" replace />;
  }

  if (projects.length === 0) {
    return <Navigate to="/setup/projects/new" replace />;
  }

  return <ProjectsHubPage />;
}
