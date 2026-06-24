import type {WorkflowStatusVisual} from '#components/workflow-status/status-visuals.js';
import {getWorkflowStatusVisual} from '#components/workflow-status/status-visuals.js';
import type {WorkflowRun} from '#core/workflow-run.js';

export interface WorkflowRunSummaryModel {
  id: string;
  shortId: string;
  name: string;
  status: WorkflowStatusVisual;
  triggerSource: string;
  triggerLabel: string | undefined;
  triggeredAt: string;
}

export function toWorkflowRunSummary(run: WorkflowRun): WorkflowRunSummaryModel {
  return {
    id: run.id,
    shortId: run.shortId,
    name: run.name,
    status: getWorkflowStatusVisual(run.status),
    triggerSource: run.triggerSource,
    triggerLabel: run.triggerLabel || undefined,
    triggeredAt: run.createdAt,
  };
}
