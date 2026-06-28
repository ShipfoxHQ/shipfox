import type {RunDto} from '@shipfox/api-workflows-dto';
import type {WorkflowRun} from '#core/entities/workflow-run.js';

export function toRunDto(run: WorkflowRun): RunDto {
  return {
    id: run.id,
    project_id: run.projectId,
    definition_id: run.definitionId,
    name: run.name,
    status: run.status,
    source_run_id: run.sourceRunId,
    root_run_id: run.rootRunId,
    attempt: run.attempt,
    rerun_mode: run.rerunMode,
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
