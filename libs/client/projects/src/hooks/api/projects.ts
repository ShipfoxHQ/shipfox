import type {
  CreateProjectBodyDto,
  ListProjectsResponseDto,
  ProjectResponseDto,
} from '@shipfox/api-projects-dto';
import {apiRequest} from '@shipfox/client-api';
import {
  keepPreviousData,
  queryOptions,
  useInfiniteQuery,
  useMutation,
  useQuery,
} from '@tanstack/react-query';

export const projectsQueryKeys = {
  all: ['projects'] as const,
  list: (workspaceId: string, search?: string) =>
    [...projectsQueryKeys.all, 'list', workspaceId, search ?? ''] as const,
  exists: (workspaceId: string) => [...projectsQueryKeys.all, 'exists', workspaceId] as const,
  detail: (projectId: string) => [...projectsQueryKeys.all, 'detail', projectId] as const,
};

export async function listProjects({
  workspaceId,
  limit = 50,
  cursor,
  search,
  signal,
}: {
  workspaceId: string;
  limit?: number;
  cursor?: string | undefined;
  search?: string | undefined;
  signal?: AbortSignal;
}) {
  const params = new URLSearchParams({workspace_id: workspaceId, limit: String(limit)});
  if (cursor) params.set('cursor', cursor);
  if (search) params.set('search', search);

  return await apiRequest<ListProjectsResponseDto>(`/projects?${params.toString()}`, {signal});
}

export async function getProject(projectId: string) {
  return await apiRequest<ProjectResponseDto>(`/projects/${projectId}`);
}

export async function createProject(body: CreateProjectBodyDto) {
  return await apiRequest<ProjectResponseDto>('/projects', {method: 'POST', body});
}

export function projectExistenceQueryOptions(workspaceId: string) {
  return queryOptions({
    queryKey: projectsQueryKeys.exists(workspaceId),
    queryFn: ({signal}) => listProjects({workspaceId, limit: 1, signal}),
    staleTime: 30_000,
  });
}

export function useProjectsInfiniteQuery(
  workspaceId: string | undefined,
  search?: string,
  limit = 50,
) {
  return useInfiniteQuery({
    queryKey: workspaceId
      ? projectsQueryKeys.list(workspaceId, search)
      : [...projectsQueryKeys.all, 'list'],
    enabled: Boolean(workspaceId),
    initialPageParam: undefined as string | undefined,
    queryFn: ({pageParam, signal}) =>
      listProjects({workspaceId: workspaceId ?? '', limit, cursor: pageParam, search, signal}),
    getNextPageParam: (lastPage) => lastPage.next_cursor ?? undefined,
    placeholderData: keepPreviousData,
  });
}

export function useProjectQuery(projectId: string | undefined) {
  return useQuery({
    queryKey: projectId
      ? projectsQueryKeys.detail(projectId)
      : [...projectsQueryKeys.all, 'detail'],
    enabled: Boolean(projectId),
    queryFn: () => getProject(projectId ?? ''),
  });
}

export function useCreateProjectMutation() {
  return useMutation({mutationFn: createProject});
}
