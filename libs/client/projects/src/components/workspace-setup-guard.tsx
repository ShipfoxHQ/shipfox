import type {ListIntegrationConnectionsResponseDto} from '@shipfox/api-integration-core-dto';
import type {ListProjectsResponseDto} from '@shipfox/api-projects-dto';
import {
  isModelProviderOnboardingDismissed,
  listModelProviderConfigs,
  modelProviderQueryKeys,
} from '@shipfox/client-agent';
import {integrationsQueryKeys, listSourceConnections} from '@shipfox/client-integrations';
import {WorkspaceSetupLoadError, type WorkspaceSetupState} from '@shipfox/client-shell/runtime';
import type {QueryClient} from '@tanstack/react-query';
import {redirect} from '@tanstack/react-router';
import {listProjects, projectsQueryKeys} from '#hooks/api/projects.js';

const TRAILING_SLASHES_RE = /\/+$/u;
const PROJECT_EXISTENCE_STALE_TIME_MS = 30_000;
type ListModelProviderConfigsResponseDto = Awaited<ReturnType<typeof listModelProviderConfigs>>;

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
