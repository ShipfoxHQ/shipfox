import {
  listProjectConfigCommitsResponseSchema,
  listProjectConfigFilesResponseSchema,
  projectConfigResponseSchema,
  readProjectConfigFileResponseSchema,
} from '@shipfox/api-integration-core-dto';
import {ApiError, checkedApiRequest} from '@shipfox/client-api';
import {
  type InfiniteData,
  infiniteQueryOptions,
  queryOptions,
  type UseInfiniteQueryOptions,
  type UseQueryOptions,
  useInfiniteQuery,
  useQuery,
} from '@tanstack/react-query';
import type {
  ConfigCommitPage,
  ConfigFile,
  ConfigFileEntry,
  ConfigFileList,
  ProjectConfig,
} from '#core/project-config.js';
import {toConfigCommitPage, toConfigFile, toConfigFileEntry, toProjectConfig} from './mappers.js';

const CONFIG_FILES_PAGE_SIZE = 500;
const CONFIG_COMMITS_PAGE_SIZE = 30;

export const projectConfigQueryKeys = {
  all: ['project-config'] as const,
  source: (projectId: string) => [...projectConfigQueryKeys.all, 'source', projectId] as const,
  files: (projectId: string, commit: string) =>
    [...projectConfigQueryKeys.all, 'files', projectId, commit] as const,
  file: (projectId: string, commit: string, path: string) =>
    [...projectConfigQueryKeys.all, 'file', projectId, commit, path] as const,
  commits: (projectId: string, commit: string, path: string) =>
    [...projectConfigQueryKeys.all, 'commits', projectId, commit, path] as const,
};

/**
 * Retries only failures that can clear on their own. A refusal such as a binary file, or an
 * adopted-session gate, answers the same on every try, and this replaces the shell's default.
 */
function retryServerFailures(failureCount: number, error: Error): boolean {
  const isTransient =
    error instanceof ApiError && (error.status >= 500 || error.code === 'network-error');
  return isTransient && failureCount < 3;
}

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

/** Reads every page, because the tree needs every path before it can draw a folder. */
export async function listProjectConfigFiles({
  projectId,
  commit,
  signal,
}: {
  projectId: string;
  commit: string;
  signal?: AbortSignal | undefined;
}): Promise<ConfigFileList> {
  const files: ConfigFileEntry[] = [];
  let cursor: string | null = null;
  do {
    const params = new URLSearchParams({ref: commit, limit: String(CONFIG_FILES_PAGE_SIZE)});
    if (cursor) params.set('cursor', cursor);
    const page = await checkedApiRequest(
      listProjectConfigFilesResponseSchema,
      `/projects/${projectId}/config/files?${params.toString()}`,
      {signal},
    );
    files.push(...page.files.map(toConfigFileEntry));
    cursor = page.next_cursor;
  } while (cursor);
  return {commit, files};
}

export function projectConfigFilesQueryOptions({
  projectId,
  commit,
}: {
  projectId: string;
  commit: string | undefined;
}): UseQueryOptions<
  ConfigFileList,
  Error,
  ConfigFileList,
  ReturnType<typeof projectConfigQueryKeys.files>
> {
  return queryOptions({
    queryKey: projectConfigQueryKeys.files(projectId, commit ?? ''),
    enabled: Boolean(commit),
    queryFn: ({signal}) => listProjectConfigFiles({projectId, commit: commit ?? '', signal}),
    retry: retryServerFailures,
  });
}

export function useProjectConfigFilesQuery(input: {projectId: string; commit: string | undefined}) {
  return useQuery(projectConfigFilesQueryOptions(input));
}

export async function readProjectConfigFile({
  projectId,
  commit,
  path,
  signal,
}: {
  projectId: string;
  commit: string;
  path: string;
  signal?: AbortSignal | undefined;
}): Promise<ConfigFile> {
  const encodedPath = path.split('/').map(encodeURIComponent).join('/');
  const params = new URLSearchParams({ref: commit});
  return toConfigFile(
    await checkedApiRequest(
      readProjectConfigFileResponseSchema,
      `/projects/${projectId}/config/files/${encodedPath}?${params.toString()}`,
      {signal},
    ),
  );
}

interface ProjectConfigFileQueryInput {
  projectId: string;
  commit: string;
  path: string;
  enabled?: boolean;
}

export function projectConfigFileQueryOptions({
  projectId,
  commit,
  path,
  enabled = true,
}: ProjectConfigFileQueryInput): UseQueryOptions<
  ConfigFile,
  Error,
  ConfigFile,
  ReturnType<typeof projectConfigQueryKeys.file>
> {
  return queryOptions({
    queryKey: projectConfigQueryKeys.file(projectId, commit, path),
    enabled,
    queryFn: ({signal}) => readProjectConfigFile({projectId, commit, path, signal}),
    retry: retryServerFailures,
  });
}

export function useProjectConfigFileQuery(input: ProjectConfigFileQueryInput) {
  return useQuery(projectConfigFileQueryOptions(input));
}

export async function listProjectConfigCommits({
  projectId,
  commit,
  path,
  cursor,
  signal,
}: {
  projectId: string;
  commit: string;
  path: string;
  cursor?: string | undefined;
  signal?: AbortSignal | undefined;
}): Promise<ConfigCommitPage> {
  const params = new URLSearchParams({
    path,
    ref: commit,
    limit: String(CONFIG_COMMITS_PAGE_SIZE),
  });
  if (cursor) params.set('cursor', cursor);
  return toConfigCommitPage(
    await checkedApiRequest(
      listProjectConfigCommitsResponseSchema,
      `/projects/${projectId}/config/commits?${params.toString()}`,
      {signal},
    ),
  );
}

interface ProjectConfigCommitsQueryInput {
  projectId: string;
  commit: string;
  path: string;
}

export function projectConfigCommitsInfiniteQueryOptions({
  projectId,
  commit,
  path,
}: ProjectConfigCommitsQueryInput): UseInfiniteQueryOptions<
  ConfigCommitPage,
  Error,
  InfiniteData<ConfigCommitPage, string | undefined>,
  ReturnType<typeof projectConfigQueryKeys.commits>,
  string | undefined
> {
  return infiniteQueryOptions({
    queryKey: projectConfigQueryKeys.commits(projectId, commit, path),
    initialPageParam: undefined as string | undefined,
    queryFn: ({pageParam, signal}) =>
      listProjectConfigCommits({projectId, commit, path, cursor: pageParam, signal}),
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    retry: retryServerFailures,
  });
}

export function useProjectConfigCommitsInfiniteQuery(input: ProjectConfigCommitsQueryInput) {
  return useInfiniteQuery(projectConfigCommitsInfiniteQueryOptions(input));
}
