import type {RunAttemptDto, RunDto} from '@shipfox/api-workflows-dto';
import type {WorkflowRun} from '#core/entities/workflow-run.js';
import type {WorkflowRunAttempt} from '#core/entities/workflow-run-attempt.js';

export function toRunDto(run: WorkflowRun, latestAttempt = run.currentAttempt): RunDto {
  return {
    id: run.id,
    project_id: run.projectId,
    definition_id: run.definitionId,
    name: run.name,
    status: run.status,
    current_attempt: run.currentAttempt,
    latest_attempt: latestAttempt,
    trigger_source: run.triggerSource,
    trigger_event: run.triggerEvent,
    trigger_payload: run.triggerPayload,
    inputs: run.inputs,
    source_snapshot: run.sourceSnapshot,
    created_at: run.createdAt.toISOString(),
    updated_at: run.updatedAt.toISOString(),
    started_at: run.startedAt?.toISOString() ?? null,
    finished_at: run.finishedAt?.toISOString() ?? null,
  };
}

export function toRunAttemptDto(attempt: WorkflowRunAttempt): RunAttemptDto {
  return {
    id: attempt.id,
    workflow_run_id: attempt.workflowRunId,
    attempt: attempt.attempt,
    status: attempt.status,
    created_at: attempt.createdAt.toISOString(),
    started_at: attempt.startedAt?.toISOString() ?? null,
    finished_at: attempt.finishedAt?.toISOString() ?? null,
    rerun_mode: attempt.rerunMode,
  };
}
