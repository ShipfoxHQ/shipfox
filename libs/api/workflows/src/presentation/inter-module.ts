import type {DefinitionsInterModuleClient} from '@shipfox/api-definitions-dto/inter-module';
import {workflowsInterModuleContract} from '@shipfox/api-workflows-dto/inter-module';
import {
  createInterModuleKnownError,
  defineInterModulePresentation,
  type InterModulePresentation,
} from '@shipfox/inter-module';
import {InvalidJobRunnerLabelsError} from '#core/errors.js';
import {
  AgentConfigUnresolvableError,
  AgentIntegrationMaterializationError,
  DefinitionNotFoundError,
  InterpolationUnresolvableError,
  ProjectMismatchError,
  runWorkflow,
} from '#core/index.js';
import {deliverEventToListener} from '#db/job-listener-events.js';

export function createWorkflowsInterModulePresentation(params: {
  definitions: DefinitionsInterModuleClient;
}): InterModulePresentation<typeof workflowsInterModuleContract> {
  return defineInterModulePresentation(workflowsInterModuleContract, {
    startRunFromTrigger: async (input) => {
      try {
        const run = await runWorkflow(params.definitions, {
          workspaceId: input.workspaceId,
          projectId: input.projectId,
          definitionId: input.definitionId,
          triggerPayload: input.triggerPayload,
          inputs: input.inputs,
          triggerIdempotencyKey: input.idempotencyKey,
        });
        return {id: run.id, name: run.name};
      } catch (error) {
        throw toStartRunKnownError(error, input.definitionId);
      }
    },
    deliverEventToJobListener: async (input) =>
      await deliverEventToListener({...input, receivedAt: new Date(input.receivedAt)}),
  });
}

export function toStartRunKnownError(error: unknown, definitionId: string): unknown {
  const method = workflowsInterModuleContract.methods.startRunFromTrigger;
  if (error instanceof DefinitionNotFoundError) {
    return createInterModuleKnownError(method, 'definition-not-found', {definitionId});
  }
  if (error instanceof ProjectMismatchError) {
    return createInterModuleKnownError(method, 'project-mismatch', {});
  }
  if (error instanceof AgentConfigUnresolvableError) {
    return createInterModuleKnownError(method, 'agent-config-unresolvable', {
      definitionId: error.definitionId,
    });
  }
  if (error instanceof AgentIntegrationMaterializationError) {
    return createInterModuleKnownError(method, 'agent-integration-materialization-failed', {});
  }
  if (error instanceof InterpolationUnresolvableError) {
    return createInterModuleKnownError(method, 'interpolation-unresolvable', {
      definitionId: error.definitionId,
      field: error.field,
      source: error.source,
      ...(error.envKey === undefined ? {} : {envKey: error.envKey}),
    });
  }
  if (error instanceof InvalidJobRunnerLabelsError) {
    return createInterModuleKnownError(method, 'invalid-job-runner-labels', {
      labels: [...error.labels],
    });
  }
  return error;
}
