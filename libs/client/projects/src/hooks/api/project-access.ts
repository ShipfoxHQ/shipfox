import {listScopeResourcesResponseSchema} from '@shipfox/api-integration-core-dto';
import {
  projectAccessResponseSchema,
  updateProjectAccessBodySchema,
} from '@shipfox/api-projects-dto';
import {checkedApiRequest} from '@shipfox/client-api';
import {
  infiniteQueryOptions,
  queryOptions,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import type {
  ProjectAccess,
  ScopeResourcePage,
  UpdateProjectAccessCommand,
} from '#core/project-access.js';
import {toProjectAccess, toScopeResourcePage} from './mappers.js';

const SCOPE_RESOURCES_PAGE_SIZE = 50;

export const projectAccessQueryKeys = {
  all: ['project-access'] as const,
  detail: (projectId: string) => [...projectAccessQueryKeys.all, 'detail', projectId] as const,
  scopeResources: (connectionId: string, kind: string, search: string) =>
    [...projectAccessQueryKeys.all, 'scope-resources', connectionId, kind, search] as const,
};

export async function getProjectAccess({
  projectId,
  signal,
}: {
  projectId: string;
  signal?: AbortSignal | undefined;
}): Promise<ProjectAccess> {
  return toProjectAccess(
    await checkedApiRequest(projectAccessResponseSchema, `/projects/${projectId}/access`, {
      signal,
    }),
  );
}

export async function updateProjectAccess(
  command: UpdateProjectAccessCommand,
): Promise<ProjectAccess> {
  const body = updateProjectAccessBodySchema.parse({
    connections:
      command.connections === 'all'
        ? 'all'
        : command.connections.map((connection) => ({
            connection_id: connection.connectionId,
            resources:
              connection.resources === 'all'
                ? 'all'
                : connection.resources.map((resource) => ({
                    kind: resource.kind,
                    external_id: resource.externalId,
                  })),
          })),
  });
  return toProjectAccess(
    await checkedApiRequest(projectAccessResponseSchema, `/projects/${command.projectId}/access`, {
      method: 'PUT',
      body,
    }),
  );
}

export async function listScopeResources({
  connectionId,
  kind,
  cursor,
  search,
  signal,
}: {
  connectionId: string;
  kind: string;
  cursor?: string | undefined;
  search?: string | undefined;
  signal?: AbortSignal | undefined;
}): Promise<ScopeResourcePage> {
  const params = new URLSearchParams({kind, limit: String(SCOPE_RESOURCES_PAGE_SIZE)});
  if (cursor) params.set('cursor', cursor);
  if (search) params.set('search', search);
  return toScopeResourcePage(
    await checkedApiRequest(
      listScopeResourcesResponseSchema,
      `/integration-connections/${encodeURIComponent(connectionId)}/scope-resources?${params.toString()}`,
      {signal},
    ),
  );
}

export function projectAccessQueryOptions(projectId: string | undefined) {
  return queryOptions({
    queryKey: projectId
      ? projectAccessQueryKeys.detail(projectId)
      : ([...projectAccessQueryKeys.all, 'detail'] as const),
    enabled: Boolean(projectId),
    queryFn: ({signal}) => getProjectAccess({projectId: projectId ?? '', signal}),
  });
}

export function useProjectAccessQuery(projectId: string | undefined) {
  return useQuery(projectAccessQueryOptions(projectId));
}

export function scopeResourcesInfiniteQueryOptions({
  connectionId,
  kind,
  search,
}: {
  connectionId: string;
  kind: string;
  search?: string | undefined;
}) {
  const trimmedSearch = search?.trim() ?? '';
  return infiniteQueryOptions({
    queryKey: projectAccessQueryKeys.scopeResources(connectionId, kind, trimmedSearch),
    initialPageParam: undefined as string | undefined,
    queryFn: ({pageParam, signal}) =>
      listScopeResources({
        connectionId,
        kind,
        cursor: pageParam,
        search: trimmedSearch || undefined,
        signal,
      }),
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });
}

export function useScopeResourcesInfiniteQuery(input: {
  connectionId: string;
  kind: string;
  search?: string | undefined;
}) {
  return useInfiniteQuery(scopeResourcesInfiniteQueryOptions(input));
}

export function useUpdateProjectAccessMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: updateProjectAccess,
    onSuccess: (access) => {
      queryClient.setQueryData(projectAccessQueryKeys.detail(access.projectId), access);
    },
  });
}
