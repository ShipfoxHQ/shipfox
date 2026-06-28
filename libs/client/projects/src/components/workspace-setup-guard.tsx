import type {ListIntegrationConnectionsResponseDto} from '@shipfox/api-integration-core-dto';
import type {ListProjectsResponseDto} from '@shipfox/api-projects-dto';
import {ApiError} from '@shipfox/client-api';
import {integrationsQueryKeys, listSourceConnections} from '@shipfox/client-integrations';
import {Alert, Button, FullPageLoader, Header, Text} from '@shipfox/react-ui';
import type {QueryClient} from '@tanstack/react-query';
import {type ErrorComponentProps, redirect, useRouter} from '@tanstack/react-router';
import {listProjects, projectsQueryKeys} from '#hooks/api/projects.js';

const TRAILING_SLASHES_RE = /\/+$/u;

export interface WorkspaceSetupState {
  hideProjectNavigation: boolean;
}

export interface WorkspaceSetupRouteOptions {
  queryClient: QueryClient;
  workspaceId: string;
  pathname: string;
}

export async function loadWorkspaceSetupRoute({
  queryClient,
  workspaceId,
  pathname,
}: WorkspaceSetupRouteOptions): Promise<WorkspaceSetupState> {
  const projects = await fetchWorkspaceProjectExistence(queryClient, workspaceId);
  const normalizedPathname = normalizePath(pathname);
  const hasProject = projects.projects.length > 0;

  if (hasProject) {
    if (isIntegrationsIndexPath(normalizedPathname, workspaceId)) {
      throw redirect({
        to: '/workspaces/$wid/settings/integrations',
        params: {wid: workspaceId},
        replace: true,
      });
    }

    return {hideProjectNavigation: false};
  }

  const sourceConnections = await fetchWorkspaceSourceConnections(queryClient, workspaceId);
  const hasSourceConnection = sourceConnections.connections.length > 0;

  if (!hasSourceConnection) {
    if (isIntegrationsPath(normalizedPathname, workspaceId)) {
      return {hideProjectNavigation: true};
    }

    throw redirect({
      to: '/workspaces/$wid/integrations',
      params: {wid: workspaceId},
      replace: true,
    });
  }

  if (isProjectCreationPath(normalizedPathname, workspaceId)) {
    return {hideProjectNavigation: true};
  }

  throw redirect({
    to: '/workspaces/$wid/projects/new',
    params: {wid: workspaceId},
    replace: true,
  });
}

export function WorkspaceSetupPending() {
  return <FullPageLoader />;
}

export function WorkspaceSetupErrorRoute({error, reset}: ErrorComponentProps) {
  const router = useRouter();

  return (
    <WorkspaceSetupError
      message={setupErrorMessage(error)}
      onRetry={() => {
        reset();
        void router.invalidate();
      }}
    />
  );
}

function WorkspaceSetupError({message, onRetry}: {message: string; onRetry: () => void}) {
  return (
    <main className="min-h-screen bg-background-subtle-base px-24 py-32 max-[520px]:px-16">
      <div className="mx-auto flex w-full max-w-[640px] flex-col gap-24">
        <Header variant="h1">Workspace setup</Header>
        <Alert variant="error">
          <div className="flex flex-col gap-8">
            <Text size="sm" bold>
              Could not load workspace setup
            </Text>
            <Text size="sm">{message}</Text>
            <Button size="sm" variant="secondary" onClick={onRetry} className="w-fit">
              Retry
            </Button>
          </div>
        </Alert>
      </div>
    </main>
  );
}

function setupErrorMessage(error: unknown) {
  if (error instanceof ApiError) return error.message;
  return 'Try again in a moment.';
}

async function fetchWorkspaceProjectExistence(queryClient: QueryClient, workspaceId: string) {
  const queryKey = projectsQueryKeys.exists(workspaceId);

  try {
    return await queryClient.fetchQuery({
      queryKey,
      queryFn: ({signal}) => listProjects({workspaceId, limit: 1, signal}),
    });
  } catch (error) {
    const cached = queryClient.getQueryData<ListProjectsResponseDto>(queryKey);
    if (cached !== undefined) return cached;
    throw error;
  }
}

async function fetchWorkspaceSourceConnections(queryClient: QueryClient, workspaceId: string) {
  const queryKey = integrationsQueryKeys.sourceConnections(workspaceId);

  try {
    return await queryClient.fetchQuery({
      queryKey,
      queryFn: ({signal}) => listSourceConnections({workspaceId, signal}),
    });
  } catch (error) {
    const cached = queryClient.getQueryData<ListIntegrationConnectionsResponseDto>(queryKey);
    if (cached !== undefined) return cached;
    throw error;
  }
}

function normalizePath(pathname: string) {
  if (pathname === '/') return pathname;
  return pathname.replace(TRAILING_SLASHES_RE, '');
}

function workspacePath(workspaceId: string, suffix: string) {
  return `/workspaces/${workspaceId}${suffix}`;
}

function isIntegrationsIndexPath(pathname: string, workspaceId: string) {
  return pathname === workspacePath(workspaceId, '/integrations');
}

function isIntegrationsPath(pathname: string, workspaceId: string) {
  const basePath = workspacePath(workspaceId, '/integrations');
  return pathname === basePath || pathname.startsWith(`${basePath}/`);
}

function isProjectCreationPath(pathname: string, workspaceId: string) {
  return pathname === workspacePath(workspaceId, '/projects/new');
}
