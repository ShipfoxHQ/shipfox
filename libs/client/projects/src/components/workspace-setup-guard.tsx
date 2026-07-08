import type {ListIntegrationConnectionsResponseDto} from '@shipfox/api-integration-core-dto';
import type {ListProjectsResponseDto} from '@shipfox/api-projects-dto';
import {
  isModelProviderOnboardingDismissed,
  listModelProviderConfigs,
  modelProviderQueryKeys,
} from '@shipfox/client-agent';
import {ApiError} from '@shipfox/client-api';
import {integrationsQueryKeys, listSourceConnections} from '@shipfox/client-integrations';
import {Button} from '@shipfox/react-ui/button';
import {Callout} from '@shipfox/react-ui/callout';
import {FullPageLoader} from '@shipfox/react-ui/loader';
import {Header, Text} from '@shipfox/react-ui/typography';
import type {QueryClient} from '@tanstack/react-query';
import {type ErrorComponentProps, redirect, useRouter} from '@tanstack/react-router';
import {listProjects, projectsQueryKeys} from '#hooks/api/projects.js';

const TRAILING_SLASHES_RE = /\/+$/u;
const PROJECT_EXISTENCE_STALE_TIME_MS = 30_000;
type ListModelProviderConfigsResponseDto = Awaited<ReturnType<typeof listModelProviderConfigs>>;

export interface WorkspaceSetupState {
  hideProjectNavigation: boolean;
}

export interface WorkspaceSetupRouteOptions {
  queryClient: QueryClient;
  workspaceId: string;
  pathname: string;
}

export class WorkspaceSetupLoadError extends Error {
  constructor(public override readonly cause: unknown) {
    super(cause instanceof Error ? cause.message : 'Workspace setup load failed');
    this.name = 'WorkspaceSetupLoadError';
  }
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

  if (isAgentSettingsPath(normalizedPathname, workspaceId)) {
    return {hideProjectNavigation: true};
  }

  const providerHandled = await hasHandledModelProviderOnboarding(queryClient, workspaceId);
  if (!providerHandled) {
    if (isModelProviderOnboardingPath(normalizedPathname, workspaceId)) {
      return {hideProjectNavigation: true};
    }

    throw redirect({
      to: '/workspaces/$wid/model-provider',
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

export function WorkspaceLayoutErrorRoute({error, reset}: ErrorComponentProps) {
  const router = useRouter();
  const onRetry = () => {
    reset();
    void router.invalidate();
  };

  if (!(error instanceof WorkspaceSetupLoadError)) {
    return <WorkspaceRouteError message={routeErrorMessage(error)} onRetry={onRetry} />;
  }

  return <WorkspaceSetupError message={setupErrorMessage(error)} onRetry={onRetry} />;
}

function WorkspaceSetupError({message, onRetry}: {message: string; onRetry: () => void}) {
  return (
    <main className="min-h-screen bg-background-subtle-base px-24 py-32 max-[520px]:px-16">
      <div className="mx-auto flex w-full max-w-[640px] flex-col gap-24">
        <Header variant="h1">Workspace setup</Header>
        <Callout role="alert" type="error">
          <div className="flex flex-col gap-8">
            <Text size="sm" bold>
              Could not load workspace setup
            </Text>
            <Text size="sm">{message}</Text>
            <Button size="sm" variant="secondary" onClick={onRetry} className="w-fit">
              Retry
            </Button>
          </div>
        </Callout>
      </div>
    </main>
  );
}

function setupErrorMessage(error: unknown) {
  const cause = error instanceof WorkspaceSetupLoadError ? error.cause : error;
  if (cause instanceof ApiError) return cause.message;
  return 'Try again in a moment.';
}

function WorkspaceRouteError({message, onRetry}: {message: string; onRetry: () => void}) {
  return (
    <main className="min-h-screen bg-background-subtle-base px-24 py-32 max-[520px]:px-16">
      <div className="mx-auto flex w-full max-w-[640px] flex-col gap-24">
        <Header variant="h1">Workspace</Header>
        <Callout role="alert" type="error">
          <div className="flex flex-col gap-8">
            <Text size="sm" bold>
              Could not load workspace
            </Text>
            <Text size="sm">{message}</Text>
            <Button size="sm" variant="secondary" onClick={onRetry} className="w-fit">
              Retry
            </Button>
          </div>
        </Callout>
      </div>
    </main>
  );
}

function routeErrorMessage(error: unknown) {
  if (error instanceof ApiError) return error.message;
  return 'Try again in a moment.';
}

async function fetchWorkspaceProjectExistence(queryClient: QueryClient, workspaceId: string) {
  const queryKey = projectsQueryKeys.exists(workspaceId);

  try {
    return await queryClient.fetchQuery({
      queryKey,
      queryFn: ({signal}) => listProjects({workspaceId, limit: 1, signal}),
      // beforeLoad runs for every in-workspace navigation. Use a short
      // freshness window to avoid hot-path refetches while still detecting
      // project creation from another tab or actor.
      staleTime: PROJECT_EXISTENCE_STALE_TIME_MS,
    });
  } catch (error) {
    const cached = queryClient.getQueryData<ListProjectsResponseDto>(queryKey);
    if (cached !== undefined) return cached;
    throw new WorkspaceSetupLoadError(error);
  }
}

async function fetchWorkspaceSourceConnections(queryClient: QueryClient, workspaceId: string) {
  const queryKey = integrationsQueryKeys.sourceConnections(workspaceId);

  try {
    // Onboarding-only path: kept fresh (no staleTime) because some install
    // flows connect a source without invalidating this key, and a stale
    // "no connection" read would trap the user in the onboarding redirect.
    return await queryClient.fetchQuery({
      queryKey,
      queryFn: ({signal}) => listSourceConnections({workspaceId, signal}),
    });
  } catch (error) {
    const cached = queryClient.getQueryData<ListIntegrationConnectionsResponseDto>(queryKey);
    if (cached !== undefined) return cached;
    throw new WorkspaceSetupLoadError(error);
  }
}

async function hasHandledModelProviderOnboarding(
  queryClient: QueryClient,
  workspaceId: string,
): Promise<boolean> {
  if (isModelProviderOnboardingDismissed(workspaceId)) return true;

  const configs = await fetchWorkspaceModelProviderConfigs(queryClient, workspaceId);
  return configs === null || configs.configs.length > 0;
}

async function fetchWorkspaceModelProviderConfigs(
  queryClient: QueryClient,
  workspaceId: string,
): Promise<ListModelProviderConfigsResponseDto | null> {
  const queryKey = modelProviderQueryKeys.configs(workspaceId);

  try {
    return await queryClient.fetchQuery({
      queryKey,
      queryFn: ({signal}) => listModelProviderConfigs({workspaceId, signal}),
    });
  } catch {
    const cached = queryClient.getQueryData<ListModelProviderConfigsResponseDto>(queryKey);
    if (cached !== undefined) return cached;
    return null;
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

function isModelProviderOnboardingPath(pathname: string, workspaceId: string) {
  return pathname === workspacePath(workspaceId, '/model-provider');
}

function isAgentSettingsPath(pathname: string, workspaceId: string) {
  return pathname === workspacePath(workspaceId, '/settings/agents');
}
