import type {RunDto} from '@shipfox/api-workflows-dto';
import type {WorkflowRun} from '#core/entities/workflow-run.js';

export function toRunDto(run: WorkflowRun): RunDto {
  return {
    id: run.id,
    project_id: run.projectId,
    definition_id: run.definitionId,
    name: run.name,
    status: run.status,
    trigger_source: run.triggerSource,
    trigger_event: run.triggerEvent,
    trigger_payload: run.triggerPayload,
    inputs: run.inputs,
    duration_ms: 0,
    created_at: run.createdAt.toISOString(),
    updated_at: run.updatedAt.toISOString(),
  };
}
