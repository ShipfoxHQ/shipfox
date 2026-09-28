import {definitionsQueryKeys, listDefinitions, listProjects} from '@shipfox/client-projects';
import {listWorkflowRuns} from '@shipfox/client-workflows';
import {queryOptions, useQuery, useQueryClient} from '@tanstack/react-query';
import {useEffect} from 'react';
import type {FirstWorkflowProgress} from '#core/setup-checklist.js';
import {useChecklistDismissal} from '#hooks/use-checklist-dismissal.js';

const FIRST_WORKFLOW_POLL_MS = 15_000;
const FIRST_WORKFLOW_STALE_TIME_MS = 5_000;
const PROJECT_PAGE_LIMIT = 50;

/**
 * The workspace scope feeds the checklist row and the home; the project scope
 * feeds one project's workflows page, so a definition or a test run elsewhere
 * never moves it.
 */
export type FirstWorkflowScope =
  | {kind: 'workspace'; workspaceId: string}
  | {kind: 'project'; projectId: string};

type FirstWorkflowQueryKey = readonly [
  'onboarding',
  'first-workflow',
  FirstWorkflowScope['kind'],
  string,
];

export const firstWorkflowQueryKeys = {
  all: ['onboarding', 'first-workflow'] as const,
  scope: (scope: FirstWorkflowScope): FirstWorkflowQueryKey => [
    ...firstWorkflowQueryKeys.all,
    scope.kind,
    scope.kind === 'workspace' ? scope.workspaceId : scope.projectId,
  ],
};

interface TestRun {
  id: string;
  createdAt: string;
}

interface ProjectFacts {
  hasDefinition: boolean;
  latestTestRun: TestRun | undefined;
}

async function readProjectFacts(projectId: string, signal: AbortSignal): Promise<ProjectFacts> {
  const [definitions, devRuns] = await Promise.all([
    listDefinitions({projectId, limit: 1, signal}),
    listWorkflowRuns({
      projectId,
      filters: {origin: 'dev', status: 'succeeded'},
      limit: 1,
      signal,
    }),
  ]);
  const run = devRuns.runs[0];
  return {
    hasDefinition: definitions.definitions.length > 0,
    latestTestRun: run ? {id: run.id, createdAt: run.createdAt} : undefined,
  };
}

function toProgress({hasDefinition, latestTestRun}: ProjectFacts): FirstWorkflowProgress {
  if (hasDefinition) return {state: 'done'};
  if (latestTestRun) return {state: 'test_run_succeeded', testRunId: latestTestRun.id};
  return {state: 'open'};
}

function newerTestRun(current: TestRun | undefined, candidate: TestRun | undefined) {
  if (!candidate) return current;
  if (!current) return candidate;
  return candidate.createdAt > current.createdAt ? candidate : current;
}

/**
 * There is no workspace-wide definitions or runs read, so this walks the
 * projects one at a time and stops at the first definition. Workspaces reach
 * this step with one or two projects.
 */
async function readWorkspaceProgress(
  workspaceId: string,
  signal: AbortSignal,
): Promise<FirstWorkflowProgress> {
  let latestTestRun: TestRun | undefined;
  let cursor: string | undefined;
  do {
    const page = await listProjects({workspaceId, limit: PROJECT_PAGE_LIMIT, cursor, signal});
    for (const project of page.projects) {
      const facts = await readProjectFacts(project.id, signal);
      if (facts.hasDefinition) return {state: 'done'};
      latestTestRun = newerTestRun(latestTestRun, facts.latestTestRun);
    }
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
  return toProgress({hasDefinition: false, latestTestRun});
}

export function firstWorkflowQueryOptions(scope: FirstWorkflowScope) {
  return queryOptions({
    queryKey: firstWorkflowQueryKeys.scope(scope),
    queryFn: async ({signal}) =>
      scope.kind === 'workspace'
        ? readWorkspaceProgress(scope.workspaceId, signal)
        : toProgress(await readProjectFacts(scope.projectId, signal)),
    staleTime: FIRST_WORKFLOW_STALE_TIME_MS,
    retry: false,
    // The user finishes this step in a terminal or on GitHub, so the answer
    // changes while the tab sits in the background.
    refetchOnWindowFocus: true,
    refetchInterval: (query) =>
      query.state.data?.state === 'done' ? false : FIRST_WORKFLOW_POLL_MS,
    refetchIntervalInBackground: false,
  });
}

export interface FirstWorkflowQueryState {
  /** The last answer, kept through a failed poll so the row does not flicker. */
  progress: FirstWorkflowProgress | undefined;
  isError: boolean;
}

/**
 * Reads the first-workflow progress for a scope. The workspace scope follows
 * the checklist's dismissal: a dismissed checklist makes no request. The
 * project scope refreshes the project's definitions list once it sees a
 * definition, because that list does not poll and the workflows page swaps the
 * panel for it.
 */
export function useFirstWorkflowState({
  scope,
}: {
  scope: FirstWorkflowScope;
}): FirstWorkflowQueryState {
  const {dismissed} = useChecklistDismissal(scope.kind === 'workspace' ? scope.workspaceId : '');
  const enabled =
    scope.kind === 'workspace'
      ? Boolean(scope.workspaceId) && !dismissed
      : Boolean(scope.projectId);
  const query = useQuery({...firstWorkflowQueryOptions(scope), enabled, subscribed: enabled});
  const queryClient = useQueryClient();
  const projectDone =
    scope.kind === 'project' && query.data?.state === 'done' ? scope.projectId : undefined;
  useEffect(() => {
    if (!projectDone) return;
    void queryClient.invalidateQueries({queryKey: definitionsQueryKeys.list(projectDone)});
  }, [projectDone, queryClient]);
  return {progress: query.data, isError: query.isError};
}
