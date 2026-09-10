import {
  type DefinitionsInterModuleClient,
  definitionsInterModuleContract,
} from '@shipfox/api-definitions-dto/inter-module';
import {triggersInterModuleContract} from '@shipfox/api-triggers-dto/inter-module';
import {
  type WorkflowsModuleClient,
  workflowsInterModuleContract,
} from '@shipfox/api-workflows-dto/inter-module';
import {
  createInterModuleKnownError,
  defineInterModulePresentation,
  type InterModuleMethodContract,
  type InterModulePresentation,
  isInterModuleKnownError,
} from '@shipfox/inter-module';
import {createDevRun} from '#core/create-dev-run.js';
import type {TriggerDecision} from '#core/entities/decision.js';
import type {
  TriggerEventReplay,
  TriggerReceivedEvent,
  TriggerReceivedEventSummary,
} from '#core/entities/received-event.js';
import {
  DevRunInputsNotAllowedError,
  DevRunReplayEventMismatchError,
  DevRunReplayEventNotAllowedError,
  DevRunReplayEventNotFoundError,
  DevRunReplayEventRequiredError,
  DevRunReplayEventUnavailableError,
  DevRunTriggerFilteredError,
  DevRunTriggerNotFoundError,
  ManualTriggerNotFoundError,
} from '#core/errors.js';
import {fireManualTrigger} from '#core/fire-manual.js';
import {
  getTriggerEventById,
  listDecisionsByReceivedEventId,
  listDecisionsByReceivedEventIdPage,
  listReplaysOfTriggerEvent,
  listReplaysOfTriggerEventPage,
  listTriggerEventFacets,
  listTriggerEvents,
} from '#db/index.js';
import {toPublicTriggerDecisionReason} from './dto/trigger-events.js';

export function createTriggersInterModulePresentation(params: {
  definitions: DefinitionsInterModuleClient;
  workflows: WorkflowsModuleClient;
}): InterModulePresentation<typeof triggersInterModuleContract> {
  return defineInterModulePresentation(triggersInterModuleContract, {
    fireManualTrigger: async (input) => {
      try {
        return await fireManualTrigger({...input, workflows: params.workflows});
      } catch (error) {
        throw toFireManualTriggerKnownError(error);
      }
    },
    createDevRun: async (input) => {
      try {
        return await createDevRun({
          ...input,
          definitions: params.definitions,
          workflows: params.workflows,
        });
      } catch (error) {
        throw toCreateDevRunKnownError(error);
      }
    },
    listTriggerEvents: async ({workspaceId, limit, cursor, filters}) => {
      const result = await listTriggerEvents({
        workspaceId,
        limit,
        cursor: cursor ? {receivedAt: new Date(cursor.receivedAt), id: cursor.id} : undefined,
        filters: filters
          ? {
              source: filters.source,
              event: filters.event,
              origins: filters.origin,
              outcomes: filters.outcome,
              replayable: filters.replayable,
              from: filters.from ? new Date(filters.from) : undefined,
              to: filters.to ? new Date(filters.to) : undefined,
            }
          : undefined,
      });

      return {
        events: result.events.map(toTriggerEventListItem),
        nextCursor: result.nextCursor
          ? {
              receivedAt: result.nextCursor.receivedAt.toISOString(),
              id: result.nextCursor.id,
            }
          : null,
      };
    },
    getTriggerEvent: async ({workspaceId, eventId, diagnostic}) => {
      const event = await getTriggerEventById(eventId);
      if (!event || event.workspaceId !== workspaceId) {
        throw createInterModuleKnownError(
          triggersInterModuleContract.methods.getTriggerEvent,
          'trigger-event-not-found',
          {eventId},
        );
      }

      let decisions: TriggerDecision[];
      let replays: TriggerEventReplay[];
      let decisionTotalCount: number | undefined;
      let replayTotalCount: number | undefined;
      if (diagnostic) {
        const [decisionPage, replayPage] = await Promise.all([
          listDecisionsByReceivedEventIdPage({
            receivedEventId: event.id,
            limit: diagnostic.decisions,
          }),
          listReplaysOfTriggerEventPage({
            eventId: event.id,
            workspaceId: event.workspaceId,
            limit: diagnostic.replays,
          }),
        ]);
        decisions = decisionPage.items;
        replays = replayPage.items;
        decisionTotalCount = decisionPage.totalCount;
        replayTotalCount = replayPage.totalCount;
      } else {
        [decisions, replays] = await Promise.all([
          listDecisionsByReceivedEventId(event.id),
          listReplaysOfTriggerEvent(event.id, event.workspaceId),
        ]);
      }

      return {
        ...toTriggerEvent(event),
        decisions: decisions.map(toTriggerDecision),
        replays: replays.map(toTriggerEventReplay),
        ...(diagnostic
          ? {
              decisionsTotalCount: decisionTotalCount ?? decisions.length,
              replaysTotalCount: replayTotalCount ?? replays.length,
            }
          : {}),
      };
    },
    getTriggerEventFacets: async ({workspaceId}) => await listTriggerEventFacets({workspaceId}),
  });
}

function toFireManualTriggerKnownError(error: unknown): unknown {
  const method = triggersInterModuleContract.methods.fireManualTrigger;
  if (error instanceof ManualTriggerNotFoundError) {
    return createInterModuleKnownError(method, 'manual-trigger-not-found', {
      definitionId: error.workflowDefinitionId,
    });
  }

  return (
    forwardKnownError(workflowsInterModuleContract.methods.startRunFromTrigger, method, error) ??
    error
  );
}

function toCreateDevRunKnownError(error: unknown): unknown {
  const method = triggersInterModuleContract.methods.createDevRun;
  if (error instanceof DevRunTriggerNotFoundError) {
    return createInterModuleKnownError(method, 'trigger-not-found', {
      triggerKey: error.triggerKey,
    });
  }
  if (error instanceof DevRunInputsNotAllowedError) {
    return createInterModuleKnownError(method, 'inputs-not-allowed', {});
  }
  if (error instanceof DevRunReplayEventRequiredError) {
    return createInterModuleKnownError(method, 'replay-event-required', {source: error.source});
  }
  if (error instanceof DevRunReplayEventNotAllowedError) {
    return createInterModuleKnownError(method, 'replay-event-not-allowed', {source: error.source});
  }
  if (error instanceof DevRunReplayEventNotFoundError) {
    return createInterModuleKnownError(method, 'replay-event-not-found', {
      replayEventId: error.replayEventId,
    });
  }
  if (error instanceof DevRunReplayEventMismatchError) {
    return createInterModuleKnownError(method, 'replay-event-mismatch', {
      replayEventId: error.replayEventId,
    });
  }
  if (error instanceof DevRunReplayEventUnavailableError) {
    return createInterModuleKnownError(method, 'replay-event-unavailable', {
      replayEventId: error.replayEventId,
    });
  }
  if (error instanceof DevRunTriggerFilteredError) {
    return createInterModuleKnownError(method, 'trigger-filtered', {reason: error.reason});
  }

  return (
    forwardKnownError(
      definitionsInterModuleContract.methods.resolveDefinitionAtRef,
      method,
      error,
    ) ??
    forwardKnownError(workflowsInterModuleContract.methods.startDevRun, method, error) ??
    error
  );
}

function forwardKnownError(
  source: InterModuleMethodContract,
  target: InterModuleMethodContract,
  error: unknown,
): unknown {
  if (!isInterModuleKnownError(source, error)) return undefined;
  if (!(error.code in target.errors)) return undefined;
  return createInterModuleKnownError(target, error.code as never, error.details as never);
}

function toTriggerEventListItem(event: TriggerReceivedEventSummary) {
  return {
    id: event.id,
    eventRef: event.eventRef,
    origin: event.origin,
    workspaceId: event.workspaceId,
    provider: event.provider,
    source: event.source,
    event: event.event,
    replayOfEventId: event.replayOfEventId,
    deliveryId: event.deliveryId,
    connectionId: event.connectionId,
    connectionName: event.connectionName,
    outcome: event.outcome,
    matchedCount: event.matchedCount,
    receivedAt: event.receivedAt.toISOString(),
    processedAt: event.processedAt?.toISOString() ?? null,
    createdAt: event.createdAt.toISOString(),
  };
}

function toTriggerEvent(event: TriggerReceivedEvent) {
  return {
    ...toTriggerEventListItem(event),
    payload: event.payload,
    processingDiagnostic: event.processingDiagnostic ?? null,
  };
}

function toTriggerDecision(decision: TriggerDecision) {
  return {
    id: decision.id,
    receivedEventId: decision.receivedEventId,
    subscriptionKind: decision.subscriptionKind,
    subscriptionId: decision.subscriptionId,
    subscriptionName: decision.subscriptionName,
    workflowDefinitionId: decision.workflowDefinitionId,
    projectId: decision.projectId,
    workflowRunId: decision.workflowRunId,
    jobId: decision.jobId,
    matcherKind: decision.matcherKind,
    matcherOrdinal: decision.matcherOrdinal,
    decision: decision.decision,
    runId: decision.runId,
    runName: decision.runName,
    reason: toPublicTriggerDecisionReason(decision.reason),
    diagnostic: decision.diagnostic ?? null,
    createdAt: decision.createdAt.toISOString(),
  };
}

function toTriggerEventReplay(replay: TriggerEventReplay) {
  return {
    id: replay.id,
    receivedAt: replay.receivedAt.toISOString(),
    outcome: replay.outcome,
    runId: replay.runId,
  };
}
