import {ApiError} from '@shipfox/client-api';
import {useMaybeActiveWorkspace} from '@shipfox/client-auth';
import {useSourceConnectionsQuery} from '@shipfox/client-integrations';
import {Alert, Button, FullPageLoader, Header, Text} from '@shipfox/react-ui';
import {Navigate, useLocation} from '@tanstack/react-router';
import type {ReactNode} from 'react';
import {useWorkspaceProjectExistenceQuery} from '#hooks/api/projects.js';

const TRAILING_SLASHES_RE = /\/+$/u;

export interface WorkspaceSetupState {
  hideProjectNavigation: boolean;
}

export interface WorkspaceSetupGuardProps {
  children: ReactNode | ((state: WorkspaceSetupState) => ReactNode);
}

export function WorkspaceSetupGuard({children}: WorkspaceSetupGuardProps) {
  const workspace = useMaybeActiveWorkspace();
  const location = useLocation();
  const projectQuery = useWorkspaceProjectExistenceQuery(workspace?.id);
  const hasProject = (projectQuery.data?.projects.length ?? 0) > 0;
  const sourceConnectionsQuery = useSourceConnectionsQuery(
    workspace && !projectQuery.isPending && !projectQuery.isError && !hasProject
      ? workspace.id
      : undefined,
  );

  if (!workspace || projectQuery.isPending) return <FullPageLoader />;

  if (projectQuery.isError) {
    return (
      <WorkspaceSetupError
        message={setupErrorMessage(projectQuery.error)}
        onRetry={() => {
          void projectQuery.refetch();
        }}
      />
    );
  }

  const pathname = normalizePath(location.pathname);

  if (hasProject) {
    if (isIntegrationsIndexPath(pathname, workspace.id)) {
      return (
        <Navigate
          to="/workspaces/$wid/settings/integrations"
          params={{wid: workspace.id}}
          replace
        />
      );
    }

    return renderChildren(children, {hideProjectNavigation: false});
  }

  if (sourceConnectionsQuery.isPending) return <FullPageLoader />;

  if (sourceConnectionsQuery.isError) {
    return (
      <WorkspaceSetupError
        message={setupErrorMessage(sourceConnectionsQuery.error)}
        onRetry={() => {
          void sourceConnectionsQuery.refetch();
        }}
      />
    );
  }

  if (sourceConnectionsQuery.data === undefined) return <FullPageLoader />;

  const hasSourceConnection = sourceConnectionsQuery.data.connections.length > 0;

  if (!hasSourceConnection) {
    if (isIntegrationsPath(pathname, workspace.id)) {
      return renderChildren(children, {hideProjectNavigation: true});
    }

    return <Navigate to="/workspaces/$wid/integrations" params={{wid: workspace.id}} replace />;
  }

  if (isProjectCreationPath(pathname, workspace.id)) {
    return renderChildren(children, {hideProjectNavigation: true});
  }

  return <Navigate to="/workspaces/$wid/projects/new" params={{wid: workspace.id}} replace />;
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

function renderChildren(
  children: WorkspaceSetupGuardProps['children'],
  state: WorkspaceSetupState,
) {
  return typeof children === 'function' ? children(state) : children;
}

function setupErrorMessage(error: unknown) {
  if (error instanceof ApiError) return error.message;
  return 'Try again in a moment.';
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
