import type {WorkflowDocument} from '@shipfox/workflow-document';

export function hasAgentStepIntegrations(document: WorkflowDocument): boolean {
  return Object.values(document.jobs).some((job) =>
    job.steps.some((step) => step.integrations !== undefined),
  );
}
