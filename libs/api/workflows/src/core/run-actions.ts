import type {WorkspacesInterModuleClient} from '@shipfox/api-workspaces-dto/inter-module';
import {
  getWorkflowRunById,
  cancelWorkflowRun as persistCancelledWorkflowRun,
  createRerunWorkflowRun as persistRerunWorkflowRun,
} from '#db/workflow-runs.js';
import type {WorkflowRun} from './entities/workflow-run.js';
import {SourceRunNotFoundError, WorkflowRunNotFoundError} from './errors.js';
import type {WorkflowAdmissionPolicy} from './workspace-admission.js';
import {assertWorkspaceAdmitsNewJobs} from './workspace-admission.js';

export interface CancelWorkflowRunParams {
  workspaceId: string;
  workflowRunId: string;
  expectedAttempt?: number | undefined;
}

export interface RerunWorkflowRunParams {
  workspaceId: string;
  workflowRunId: string;
  expectedAttempt?: number | undefined;
  mode: 'all' | 'failed';
  actorUserId: string;
  workspaces: Pick<WorkspacesInterModuleClient, 'getWorkspaceOperatingState'>;
  admission?: {policy: WorkflowAdmissionPolicy} | undefined;
}

/**
 * Runs the shared cancellation use case after checking the caller's workspace scope.
 * The persistence function performs the locked attempt precondition and transition.
 */
export async function cancelWorkflowRun(params: CancelWorkflowRunParams): Promise<WorkflowRun> {
  const run = await getWorkflowRunById(params.workflowRunId);
  if (!run || run.workspaceId !== params.workspaceId) {
    throw new WorkflowRunNotFoundError(params.workflowRunId);
  }

  return persistCancelledWorkflowRun({
    workflowRunId: params.workflowRunId,
    expectedAttempt: params.expectedAttempt,
  });
}

/**
 * Runs the shared rerun use case for both session routes and inter-module callers.
 * Admission is deliberately inside this function so every caller gets the same gate.
 */
export async function rerunWorkflowRun(params: RerunWorkflowRunParams): Promise<WorkflowRun> {
  const run = await getWorkflowRunById(params.workflowRunId);
  if (!run || run.workspaceId !== params.workspaceId) {
    throw new SourceRunNotFoundError(params.workflowRunId);
  }

  await assertWorkspaceAdmitsNewJobs(params.workspaces, params.workspaceId, {
    policy: params.admission?.policy,
    source: run.triggerSource,
    definitionId: run.definitionId,
  });

  return persistRerunWorkflowRun({
    workflowRunId: params.workflowRunId,
    mode: params.mode,
    actorUserId: params.actorUserId,
    expectedAttempt: params.expectedAttempt,
  });
}
