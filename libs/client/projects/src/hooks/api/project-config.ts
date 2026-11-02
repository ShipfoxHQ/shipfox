import {projectConfigResponseSchema} from '@shipfox/api-integration-core-dto';
import {checkedApiRequest} from '@shipfox/client-api';
import {queryOptions, type UseQueryOptions, useQuery} from '@tanstack/react-query';
import type {ProjectConfig} from '#core/project-config.js';
import {toProjectConfig} from './mappers.js';

export const projectConfigQueryKeys = {
  all: ['project-config'] as const,
  source: (projectId: string) => [...projectConfigQueryKeys.all, 'source', projectId] as const,
};

type ProjectConfigQueryKey =
  | ReturnType<typeof projectConfigQueryKeys.source>
  | readonly ['project-config', 'source'];
type ProjectConfigQueryOptions = UseQueryOptions<
  ProjectConfig,
  Error,
  ProjectConfig,
  ProjectConfigQueryKey
>;

export async function getProjectConfig({
  projectId,
  signal,
}: {
  projectId: string;
  signal?: AbortSignal | undefined;
}): Promise<ProjectConfig> {
  return toProjectConfig(
    await checkedApiRequest(projectConfigResponseSchema, `/projects/${projectId}/config`, {
      signal,
    }),
  );
}

export function projectConfigQueryOptions(
  projectId: string | undefined,
): ProjectConfigQueryOptions {
  return queryOptions({
    queryKey: projectId
      ? projectConfigQueryKeys.source(projectId)
      : ([...projectConfigQueryKeys.all, 'source'] as const),
    enabled: Boolean(projectId),
    queryFn: ({signal}) => getProjectConfig({projectId: projectId ?? '', signal}),
  });
}

export function useProjectConfigQuery(projectId: string | undefined) {
  return useQuery(projectConfigQueryOptions(projectId));
}
