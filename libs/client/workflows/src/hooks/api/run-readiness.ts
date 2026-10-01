import {
  type RunIssueDto,
  type RunIssueLocationDto,
  runReadinessResponseSchema,
} from '@shipfox/api-triggers-dto';
import {checkedApiRequest} from '@shipfox/client-api';
import {keepPreviousData, queryOptions, useQueries, useQueryClient} from '@tanstack/react-query';
import {useCallback} from 'react';
import type {RunIssue, RunIssueLocation} from '#core/run-issue-copy.js';

export const runReadinessQueryKeys = {
  all: ['run-readiness'] as const,
  project: (projectId: string) => [...runReadinessQueryKeys.all, projectId] as const,
  definitions: (projectId: string, definitionIds: readonly string[]) =>
    [...runReadinessQueryKeys.project(projectId), definitionIds] as const,
};

export type RunReadiness = ReadonlyMap<string, readonly RunIssue[]>;

const NO_READINESS: RunReadiness = new Map();

export async function listRunReadiness({
  projectId,
  definitionIds,
  signal,
}: {
  projectId: string;
  definitionIds: readonly string[];
  signal?: AbortSignal | undefined;
}): Promise<RunReadiness> {
  const params = new URLSearchParams({project_id: projectId});
  for (const definitionId of definitionIds) params.append('definition_id', definitionId);
  const response = await checkedApiRequest(
    runReadinessResponseSchema,
    `/workflow-definitions/readiness?${params.toString()}`,
    {signal},
  );
  return new Map(
    response.definitions.map((entry) => [entry.definition_id, entry.issues.map(toRunIssue)]),
  );
}

function toRunIssueLocation(location: RunIssueLocationDto): RunIssueLocation {
  return {
    field: location.field,
    jobKey: location.job_key,
    step: location.step,
    envKey: location.env_key,
  };
}

function toRunIssue(issue: RunIssueDto): RunIssue {
  switch (issue.kind) {
    case 'variable-missing':
    case 'secret-missing':
      return {
        kind: issue.kind,
        key: issue.key,
        locations: issue.locations.map(toRunIssueLocation),
        moreLocations: issue.more_locations,
        effect: issue.effect,
      };
    case 'agent-config-invalid':
      return {
        kind: issue.kind,
        model: issue.model,
        locations: issue.locations.map(toRunIssueLocation),
        moreLocations: issue.more_locations,
        effect: issue.effect,
      };
    case 'trigger-secret-missing':
      return {kind: issue.kind, key: issue.key, trigger: issue.trigger};
    case 'secret-input-unmapped':
      return {
        kind: issue.kind,
        key: issue.key,
        trigger: issue.trigger,
        locations: issue.locations.map(toRunIssueLocation),
        moreLocations: issue.more_locations,
      };
  }
}

export function runReadinessQueryOptions(projectId: string, definitionIds: readonly string[]) {
  return queryOptions({
    queryKey: runReadinessQueryKeys.definitions(projectId, definitionIds),
    queryFn: ({signal}) => listRunReadiness({projectId, definitionIds, signal}),
    // A stale answer misleads people, so it is never served from cache without a refetch.
    staleTime: 0,
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
    // Keeps the last tag on screen while the ids change under a refetch.
    placeholderData: keepPreviousData,
    enabled: definitionIds.length > 0,
  });
}

/**
 * Readiness is advisory: while a page is loading, refetching or has failed, its rows keep their
 * last known issues or none.
 *
 * @param definitionIdPages definition ids grouped by loaded definitions page, one request each.
 */
export function useRunReadinessQuery(
  projectId: string,
  definitionIdPages: readonly (readonly string[])[],
): RunReadiness {
  return useQueries({
    queries: definitionIdPages.map((definitionIds) =>
      runReadinessQueryOptions(projectId, definitionIds),
    ),
    combine: (results) => {
      const merged = new Map<string, readonly RunIssue[]>();
      for (const result of results) {
        for (const [definitionId, issues] of result.data ?? NO_READINESS) {
          merged.set(definitionId, issues);
        }
      }
      return merged;
    },
  });
}

/** Marks every readiness answer of a project stale, for example after a refused start. */
export function useInvalidateRunReadiness(projectId: string) {
  const queryClient = useQueryClient();
  return useCallback(
    () => queryClient.invalidateQueries({queryKey: runReadinessQueryKeys.project(projectId)}),
    [projectId, queryClient],
  );
}
