import type {WorkflowRun} from '#core/workflow-run.js';

export function runTriggerLabel(run: Pick<WorkflowRun, 'triggerLabel'>): string {
  return run.triggerLabel;
}
