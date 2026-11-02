import {
  type WorkflowLatestRunDto,
  workflowLatestRunsResponseSchema,
} from '@shipfox/api-workflows-dto';
import {checkedApiRequest} from '@shipfox/client-api';
import {queryOptions, useQueries} from '@tanstack/react-query';
import type {LatestRunLookup, LatestRuns, LatestWorkflowRun} from '#core/latest-run.js';
import {isWorkflowRunTerminal} from '#core/workflow-run.js';
import {ACTIVE_POLL_MS, workflowRunsQueryKeys} from './workflow-runs.js';

function latestRunsPageKey(projectId: string, definitionIds: readonly string[]) {
  return [...workflowRunsQueryKeys.latest(projectId), definitionIds.join(',')] as const;
}

export async function listLatestWorkflowRuns({
  projectId,
  definitionIds,
  signal,
}: {
  projectId: string;
  definitionIds: readonly string[];
  signal?: AbortSignal;
}): Promise<LatestWorkflowRun[]> {
  const params = new URLSearchParams({
    project_id: projectId,
    definition_ids: definitionIds.join(','),
  });
  const response = await checkedApiRequest(
    workflowLatestRunsResponseSchema,
    `/workflows/runs/latest?${params.toString()}`,
    {signal},
  );
  return response.runs.map(toLatestWorkflowRun);
}

function toLatestWorkflowRun(run: WorkflowLatestRunDto): LatestWorkflowRun {
  return {
    id: run.id,
    definitionId: run.definition_id,
    number: run.number,
    status: run.status,
    createdAt: run.created_at,
  };
}

export function latestWorkflowRunsQueryOptions(
  projectId: string,
  definitionIds: readonly string[],
) {
  return queryOptions({
    queryKey: latestRunsPageKey(projectId, definitionIds),
    queryFn: ({signal}) => listLatestWorkflowRuns({projectId, definitionIds, signal}),
    // A run that is still going changes its glyph, so poll until every run on the page ended.
    refetchInterval: (query) =>
      query.state.data?.some((run) => !isWorkflowRunTerminal(run.status)) ? ACTIVE_POLL_MS : false,
  });
}

function pageLookups(
  definitionIds: readonly string[],
  page: {isError: boolean; data: LatestWorkflowRun[] | undefined},
): [string, LatestRunLookup][] {
  const data = page.data;
  // A failed refetch keeps the runs already loaded, so only a page with nothing to show is an error.
  if (data === undefined)
    return page.isError ? definitionIds.map((id) => [id, {status: 'error'}]) : [];
  const runs = new Map(data.map((run) => [run.definitionId, run]));
  return definitionIds.map((id) => {
    const run = runs.get(id);
    return [id, run ? {status: 'found', run} : {status: 'none'}];
  });
}

/**
 * One request per page of definitions, so a project reads its runs in as many queries as it has
 * pages. A page that fails marks only its own rows, and a page still loading leaves its rows
 * pending, so rows from other pages are never read as "No runs yet" by mistake.
 */
export function useLatestWorkflowRunsQuery(
  projectId: string,
  definitionIdPages: readonly (readonly string[])[],
): LatestRuns {
  const pages = definitionIdPages.filter((definitionIds) => definitionIds.length > 0);
  return useQueries({
    queries: pages.map((definitionIds) => latestWorkflowRunsQueryOptions(projectId, definitionIds)),
    combine: (results): LatestRuns =>
      new Map(results.flatMap((result, index) => pageLookups(pages[index] ?? [], result))),
  });
}
