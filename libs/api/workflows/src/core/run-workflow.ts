import {getDefinitionById} from '@shipfox/api-definitions';
import {
  normalizeSurfaceDocumentToWorkflowIR,
  validateWorkflowIRStaticSemantics,
} from '@shipfox/api-workflow-language';
import {createWorkflowRun} from '#db/workflow-runs.js';
import type {TriggerPayload, WorkflowRun} from './entities/workflow-run.js';
import {
  DefinitionNotFoundError,
  InvalidWorkflowDefinitionError,
  ProjectMismatchError,
} from './errors.js';

export interface RunWorkflowParams {
  workspaceId: string;
  projectId: string;
  definitionId: string;
  triggerPayload: TriggerPayload;
  inputs?: Record<string, unknown> | undefined;
  triggerIdempotencyKey?: string | undefined;
}

export async function runWorkflow(params: RunWorkflowParams): Promise<WorkflowRun> {
  const definition = await getDefinitionById(params.definitionId);
  if (!definition) throw new DefinitionNotFoundError(params.definitionId);

  if (definition.projectId !== params.projectId) {
    throw new ProjectMismatchError(definition.projectId, params.projectId);
  }

  const workflow = normalizeSurfaceDocumentToWorkflowIR(definition.definition);
  const staticSemantics = validateWorkflowIRStaticSemantics(workflow);
  if (!staticSemantics.valid) {
    throw new InvalidWorkflowDefinitionError(
      definition.id,
      staticSemantics.diagnostics.map((diagnostic) => diagnostic.message),
    );
  }

  return createWorkflowRun({
    workspaceId: params.workspaceId,
    projectId: params.projectId,
    definitionId: definition.id,
    name: definition.name,
    workflow,
    triggerPayload: params.triggerPayload,
    inputs: params.inputs,
    triggerIdempotencyKey: params.triggerIdempotencyKey,
  });
}
