import type {WorkflowRunStatus} from '#core/workflow-run.js';

/** The newest synced run of a workflow definition. */
export interface LatestWorkflowRun {
  id: string;
  definitionId: string;
  number: number;
  status: WorkflowRunStatus;
  createdAt: string;
}

/** What the "Last run" column knows about one workflow. */
export type LatestRunLookup =
  | {status: 'pending'}
  | {status: 'error'}
  | {status: 'none'}
  | {status: 'found'; run: LatestWorkflowRun};

/**
 * Keyed by definition id. A definition whose page hasn't answered yet has no entry, which
 * reads as pending, so a later page loading never resets the rows already answered.
 */
export type LatestRuns = ReadonlyMap<string, LatestRunLookup>;

export const PENDING_LATEST_RUN: LatestRunLookup = {status: 'pending'};
