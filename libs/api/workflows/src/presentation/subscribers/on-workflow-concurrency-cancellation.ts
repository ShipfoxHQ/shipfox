import type {
  WorkflowsWorkflowConcurrencyHolderCancellationRequestedEventDto,
  WorkflowsWorkflowConcurrencyWaiterSupersededEventDto,
} from '@shipfox/api-workflows-dto';
import {cancelWorkflowRunAttemptForConcurrencyWithOutcome} from '#db/workflow-runs/run-status.js';
import {recordWorkflowConcurrencyCancellationOutcome} from '#metrics/instance.js';
import {onWorkflowRunCancelled} from './on-workflow-run-cancelled.js';

type WorkflowConcurrencyCancellationEvent =
  | WorkflowsWorkflowConcurrencyHolderCancellationRequestedEventDto
  | WorkflowsWorkflowConcurrencyWaiterSupersededEventDto;

export async function onWorkflowRunConcurrencyWaiterSuperseded(
  payload: WorkflowsWorkflowConcurrencyWaiterSupersededEventDto,
): Promise<void> {
  await cancelSupersededAttempt(payload);
}

export async function onWorkflowRunConcurrencyHolderCancellationRequested(
  payload: WorkflowsWorkflowConcurrencyHolderCancellationRequestedEventDto,
): Promise<void> {
  await cancelSupersededAttempt(payload);
}

async function cancelSupersededAttempt(
  payload: WorkflowConcurrencyCancellationEvent,
): Promise<void> {
  recordWorkflowConcurrencyCancellationOutcome('requested');
  const result = await cancelWorkflowRunAttemptForConcurrencyWithOutcome({
    workflowRunAttemptId: payload.workflowRunAttemptId,
  });

  if (!result.changed) {
    recordWorkflowConcurrencyCancellationOutcome('no_op');
    return;
  }

  recordWorkflowConcurrencyCancellationOutcome('completed');
  // The terminal operation has committed before this notification is sent. The
  // operation also writes the normal cancellation event, which makes this
  // signal durable across a notification failure and idempotent on replay.
  await onWorkflowRunCancelled({
    workflowRunId: payload.workflowRunId,
    workflowRunAttemptId: payload.workflowRunAttemptId,
    projectId: payload.projectId,
  });
}
