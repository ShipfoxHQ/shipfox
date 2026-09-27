import {
  SHIPFOX_BUILTIN_CONNECTION_ID,
  SHIPFOX_PROVIDER,
  type ShipfoxEventName,
  shipfoxEventPayloadSchemas,
} from '@shipfox/api-integration-shipfox-dto';
import type {
  WorkflowsJobExecutionQueuedEventDto,
  WorkflowsJobExecutionStartedEventDto,
  WorkflowsJobTerminatedEventDto,
  WorkflowsWorkflowRunAttemptCreatedEventDto,
  WorkflowsWorkflowRunStartedEventDto,
  WorkflowsWorkflowRunTerminatedEventDto,
} from '@shipfox/api-workflows-dto';
import type {WorkflowsModuleClient} from '@shipfox/api-workflows-dto/inter-module';
import type {DomainEvent} from '@shipfox/node-outbox';
import {dispatchIntegrationEvent} from '#core/dispatch-integration-event.js';
import {findMatchingJobListenerSubscriptions} from '#db/job-listener-subscriptions.js';
import {findMatchingSubscriptions} from '#db/subscriptions.js';
import {shipfoxEventCount} from '#metrics/instance.js';

type LifecycleEvent =
  | WorkflowsWorkflowRunAttemptCreatedEventDto
  | WorkflowsWorkflowRunStartedEventDto
  | WorkflowsWorkflowRunTerminatedEventDto
  | WorkflowsJobExecutionQueuedEventDto
  | WorkflowsJobExecutionStartedEventDto
  | WorkflowsJobTerminatedEventDto;

export function createOnShipfoxLifecycleEvent(
  workflows: WorkflowsModuleClient,
  eventName: ShipfoxEventName,
) {
  return async (payload: LifecycleEvent, event: DomainEvent<LifecycleEvent>): Promise<void> => {
    const workspaceId = 'workspaceId' in payload ? payload.workspaceId : undefined;
    if (workspaceId === undefined) {
      shipfoxEventCount.add(1, {event: eventName, outcome: 'unscoped'});
      return;
    }

    const [subscriptions, listenerSubscriptions] = await Promise.all([
      findMatchingSubscriptions({workspaceId, source: SHIPFOX_PROVIDER, event: eventName}),
      findMatchingJobListenerSubscriptions({
        workspaceId,
        source: SHIPFOX_PROVIDER,
        event: eventName,
      }),
    ]);
    if (subscriptions.length === 0 && listenerSubscriptions.length === 0) {
      shipfoxEventCount.add(1, {event: eventName, outcome: 'no-subscription'});
      return;
    }

    const isJobEvent =
      eventName === 'job.queued' || eventName === 'job.started' || eventName === 'job.completed';
    const context = await workflows.getLifecycleEventContext({
      workspaceId,
      workflowRunAttemptId: payload.workflowRunAttemptId,
      ...(isJobEvent && 'jobId' in payload ? {jobId: payload.jobId} : {}),
    });
    if (context === null) {
      shipfoxEventCount.add(1, {event: eventName, outcome: 'unresolved-context'});
      return;
    }

    const normalized = buildLifecyclePayload(eventName, context, payload, event.createdAt);
    const parsed = shipfoxEventPayloadSchemas[eventName].safeParse(normalized);
    if (!parsed.success) {
      throw new Error(`Invalid Shipfox ${eventName} payload: ${parsed.error.message}`);
    }

    await dispatchIntegrationEvent({
      workflows,
      eventRef: event.id,
      workspaceId,
      provider: SHIPFOX_PROVIDER,
      source: SHIPFOX_PROVIDER,
      event: eventName,
      deliveryId: event.id,
      connectionId: SHIPFOX_BUILTIN_CONNECTION_ID,
      connectionName: SHIPFOX_PROVIDER,
      payload: parsed.data,
      receivedAt: event.createdAt,
    });
    shipfoxEventCount.add(1, {event: eventName, outcome: 'dispatched'});
  };
}

type LifecycleContext = NonNullable<
  Awaited<ReturnType<WorkflowsModuleClient['getLifecycleEventContext']>>
>;

// Terminal facts written before finishedAt existed fall back to the outbox write time,
// which is the same transaction as the transition.
function buildLifecyclePayload(
  eventName: ShipfoxEventName,
  context: LifecycleContext,
  transition: LifecycleEvent,
  writtenAt: Date,
) {
  if (eventName === 'run.requested') return buildRequestedPayload(context, transition);
  if (eventName === 'run.started') return buildStartedPayload(context, transition);
  if (eventName === 'run.completed') return buildCompletedPayload(context, transition, writtenAt);
  if (eventName === 'job.queued') return buildQueuedPayload(context, transition);
  if (eventName === 'job.started') return buildJobStartedPayload(context, transition);
  return buildJobCompletedPayload(context, transition, writtenAt);
}

function lifecycleBase(context: LifecycleContext) {
  const run = {
    id: context.run.id,
    number: context.run.number,
    attempt: context.run.attempt,
    name: context.run.name,
    origin: context.run.origin,
    trigger: context.run.trigger,
    ref: context.run.ref,
    commit: context.run.commit,
    parent_run_id: context.run.parent_run_id,
    root_run_id: context.run.root_run_id,
    created_at: context.run.created_at,
  };
  return {
    project: context.project,
    workflow: {id: context.workflow.id, name: context.workflow.name, path: context.workflow.path},
    run,
  };
}

function buildRequestedPayload(context: LifecycleContext, transition: LifecycleEvent) {
  const fact = transition as WorkflowsWorkflowRunAttemptCreatedEventDto;
  const base = lifecycleBase(context);
  return {...base, run: {...base.run, status: fact.status ?? 'pending'}};
}

function buildStartedPayload(context: LifecycleContext, transition: LifecycleEvent) {
  const fact = transition as WorkflowsWorkflowRunStartedEventDto;
  const base = lifecycleBase(context);
  return {...base, run: {...base.run, status: 'running', started_at: fact.startedAt}};
}

function buildCompletedPayload(
  context: LifecycleContext,
  transition: LifecycleEvent,
  writtenAt: Date,
) {
  const fact = transition as WorkflowsWorkflowRunTerminatedEventDto;
  const base = lifecycleBase(context);
  return {
    ...base,
    run: {
      ...base.run,
      status: fact.status,
      status_reason: fact.statusReason ?? null,
      started_at: fact.startedAt ?? null,
      finished_at: fact.finishedAt ?? writtenAt.toISOString(),
      outputs: context.run.outputs,
    },
  };
}

function buildQueuedPayload(context: LifecycleContext, transition: LifecycleEvent) {
  const fact = transition as WorkflowsJobExecutionQueuedEventDto;
  const base = lifecycleBase(context);
  return {
    ...base,
    job: {
      id: context.job?.id ?? fact.jobId,
      key: context.job?.key ?? fact.jobKey ?? '',
      mode: context.job?.mode ?? 'one_shot',
      status: 'pending',
      execution: {id: fact.jobExecutionId, sequence: fact.executionSequence ?? 1},
      queued_at: fact.queuedAt,
    },
  };
}

function buildJobStartedPayload(context: LifecycleContext, transition: LifecycleEvent) {
  const fact = transition as WorkflowsJobExecutionStartedEventDto;
  const base = lifecycleBase(context);
  return {
    ...base,
    job: {
      id: context.job?.id ?? fact.jobId,
      key: context.job?.key ?? fact.jobKey ?? '',
      mode: context.job?.mode ?? 'one_shot',
      status: 'running',
      execution: {id: fact.jobExecutionId, sequence: fact.executionSequence ?? 1},
      runner_labels: fact.runnerLabels,
      started_at: fact.startedAt,
    },
  };
}

function buildJobCompletedPayload(
  context: LifecycleContext,
  transition: LifecycleEvent,
  writtenAt: Date,
) {
  const fact = transition as WorkflowsJobTerminatedEventDto;
  const base = lifecycleBase(context);
  return {
    ...base,
    job: {
      id: context.job?.id ?? fact.jobId,
      key: context.job?.key ?? fact.jobKey ?? '',
      mode: context.job?.mode ?? 'one_shot',
      status: fact.status,
      status_reason: fact.statusReason,
      finished_at: fact.finishedAt ?? writtenAt.toISOString(),
      outputs: fact.status === 'succeeded' ? (context.job?.outputs ?? null) : null,
    },
  };
}
