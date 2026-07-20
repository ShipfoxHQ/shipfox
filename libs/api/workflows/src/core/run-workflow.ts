import {catalogDefaultAgentResolver} from '@shipfox/api-agent/core/resolve-agent-config';
import {createWorkspaceAgentDefaultsResolver} from '@shipfox/api-agent/core/workspace-agent-defaults-resolver';
import {workflowModelFromSnapshot} from '@shipfox/api-definitions-dto';
import type {DefinitionsInterModuleClient} from '@shipfox/api-definitions-dto/inter-module';
import type {SecretsInterModuleClient} from '@shipfox/api-secrets-dto/inter-module';
import {createWorkflowRun} from '#db/workflow-runs.js';
import type {TriggerPayload, WorkflowRun} from './entities/workflow-run.js';
import {DefinitionNotFoundError, ProjectMismatchError} from './errors.js';
import {modelHasAgentStep} from './step-config/materialize-workflow-model.js';

export interface RunWorkflowParams {
  workspaceId: string;
  projectId: string;
  definitionId: string;
  triggerPayload: TriggerPayload;
  inputs?: Record<string, unknown> | undefined;
  triggerIdempotencyKey?: string | undefined;
}

export async function runWorkflow(
  definitions: DefinitionsInterModuleClient,
  params: RunWorkflowParams,
  options: {secrets?: Pick<SecretsInterModuleClient, 'getVariablesByNamespace'>} = {},
): Promise<WorkflowRun> {
  const {definition} = await definitions.getDefinitionForWorkflowRun({
    definitionId: params.definitionId,
  });
  if (!definition) throw new DefinitionNotFoundError(params.definitionId);

  if (definition.projectId !== params.projectId) {
    throw new ProjectMismatchError(definition.projectId, params.projectId);
  }
  const model = workflowModelFromSnapshot(definition.model);
  const resolveAgentDefaults = modelHasAgentStep(model)
    ? await createWorkspaceAgentDefaultsResolver(params.workspaceId)
    : catalogDefaultAgentResolver;

  return createWorkflowRun({
    workspaceId: params.workspaceId,
    projectId: params.projectId,
    definitionId: definition.id,
    name: definition.name,
    model,
    triggerPayload: params.triggerPayload,
    inputs: params.inputs,
    sourceSnapshot: definition.sourceSnapshot,
    triggerIdempotencyKey: params.triggerIdempotencyKey,
    resolveAgentDefaults,
    secrets: options.secrets,
  });
}
