import type {RunResponseDto} from '@shipfox/api-workflows-dto';
import type {WorkflowStatusVisual} from '#components/workflow-status/status-visuals.js';
import {getWorkflowStatusVisual} from '#components/workflow-status/status-visuals.js';
import {runTriggerLabel} from '../workflow-run-display.js';

export interface WorkflowRunSummaryModel {
  id: string;
  shortId: string;
  name: string;
  status: WorkflowStatusVisual;
  triggerSource: string;
  triggerLabel: string | undefined;
  triggeredAt: string;
}

export function runShortId(id: string): string {
  return id.length <= 8 ? id : id.slice(0, 8);
}

export function toWorkflowRunSummary(run: RunResponseDto): WorkflowRunSummaryModel {
  const triggerLabel = runTriggerLabel(run);

  return {
    id: run.id,
    shortId: runShortId(run.id),
    name: run.name,
    status: getWorkflowStatusVisual(run.status),
    triggerSource: run.trigger_source,
    triggerLabel: triggerLabel || undefined,
    triggeredAt: run.created_at,
  };
}
