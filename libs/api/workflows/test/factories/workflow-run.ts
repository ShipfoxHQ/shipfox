import {Factory} from 'fishery';
import type {WorkflowRun} from '#core/entities/workflow-run.js';
import {createWorkflowRun} from '#db/workflow-runs.js';
import {workflowModel} from './workflow-model.js';

export const workflowRunFactory = Factory.define<WorkflowRun>(({onCreate}) => {
  const workspaceId = crypto.randomUUID();
  const projectId = crypto.randomUUID();
  const definitionId = crypto.randomUUID();

  onCreate((run) => {
    return createWorkflowRun({
      workspaceId: run.workspaceId,
      projectId: run.projectId,
      definitionId: run.definitionId,
      name: run.name,
      model: workflowModel({name: run.name}),
      definitionSnapshot: run.definitionSnapshot,
      triggerPayload: run.triggerPayload,
      inputs: run.inputs ?? undefined,
    });
  });

  return {
    id: crypto.randomUUID(),
    workspaceId,
    projectId,
    definitionId,
    name: 'Test Workflow',
    status: 'pending',
    triggerSource: 'manual',
    triggerEvent: 'fire',
    triggerPayload: {
      source: 'manual',
      event: 'fire',
      subscriptionId: crypto.randomUUID(),
      userId: crypto.randomUUID(),
    },
    definitionSnapshot: null,
    inputs: null,
    triggerIdempotencyKey: null,
    version: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
});
