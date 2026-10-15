import {createHash, randomUUID} from 'node:crypto';
import type {ActionUploadDto, TriggerDto} from '@shipfox/api-definitions-dto';
import type {DefinitionsInterModuleClient} from '@shipfox/api-definitions-dto/inter-module';
import {logger} from '@shipfox/node-opentelemetry';
import {getTriggerEventById} from '#db/event-queries.js';
import {devRunsCount} from '#metrics/instance.js';
import type {evaluateTriggerFilter} from './config.js';
import {
  DevRunDefinitionInvalidError,
  DevRunInputsNotAllowedError,
  DevRunReplayEventMismatchError,
  DevRunReplayEventNotAllowedError,
  DevRunReplayEventNotFoundError,
  DevRunReplayEventRequiredError,
  DevRunReplayEventUnavailableError,
  DevRunTriggerFilteredError,
  DevRunTriggerNotFoundError,
} from './errors.js';
import {matchTriggerEvent} from './match-trigger-event.js';
import {beginTriggerHistory, toReason} from './record-trigger-history.js';
import {
  isPermanentStartDevRunError,
  startDevRunDiagnostic,
  type WorkflowsModuleClient,
} from './workflows-client.js';

export interface CreateDevRunParams {
  definitions: DefinitionsInterModuleClient;
  workflows: WorkflowsModuleClient;
  workspaceId: string;
  projectId: string;
  /** Branch or tag name the definition is read from. Optional for local content. */
  ref?: string | undefined;
  /** Workflow YAML supplied by the caller instead of fetched from the repository. */
  content?: string | undefined;
  /** Whole action directories, each replacing the ref's copy of the `uses` path it names. */
  actions?: readonly ActionUploadDto[] | undefined;
  /** Commit the ref resolved to when the picker listed the file; a mismatch answers `ref-moved`. */
  commit?: string | undefined;
  configPath: string;
  /** Trigger key in the resolved workflow file's `triggers` map. */
  triggerKey: string;
  /** Manual triggers only; rejected with `inputs-not-allowed` for cron and integration triggers. */
  inputs?: Record<string, unknown> | undefined;
  /** Integration triggers only; the journaled event to replay. */
  replayEventId?: string | undefined;
  userId: string;
}

export type DevRunTriggerKind = 'manual' | 'cron' | 'replay';

export interface DevRunResult {
  id: string;
  ref?: string | undefined;
  commit: string;
  warnings?: Awaited<
    ReturnType<CreateDevRunParams['definitions']['resolveDefinitionAtRef']>
  >['warnings'];
}

/**
 * Creates a dev run from a workflow file at a git ref. The definition is
 * resolved and validated at the ref without being persisted, the trigger
 * payload is built from the trigger source, and the run is created through
 * `workflows.startDevRun` with the inline model and snapshot. Manual and cron
 * triggers fire as their production counterparts; an integration trigger
 * replays one journaled event, evaluating the trigger filter exactly as
 * dispatch does. Nothing is persisted per branch and no trigger subscription
 * is created; the journal records the attempt with a single `dev` decision.
 */
type ResolvedDevRunDefinition = Awaited<
  ReturnType<CreateDevRunParams['definitions']['resolveDefinitionAtRef']>
>;

interface DevRunPreparation {
  resolved: ResolvedDevRunDefinition;
  built: DevRunTriggerBuild;
  definitionSource: 'ref' | 'local';
  resolvedRef: string;
  triggerSource: string;
}

export async function createDevRun(params: CreateDevRunParams): Promise<DevRunResult> {
  const {resolved, built, definitionSource, resolvedRef, triggerSource} =
    await prepareDevRun(params);

  // Dev runs have no upstream event id. Use the run id after success; failed
  // attempts need a synthesized ref because there is no run to key on. A
  // replay keeps the source row's provider, connection and payload on the dev
  // journal entry, with `replay_of_event_id` pointing back at the source event.
  const historyBase = {
    origin: 'dev' as const,
    workspaceId: params.workspaceId,
    provider: built.replaySource?.provider ?? null,
    source: triggerSource,
    event: built.event,
    replayOfEventId: built.replaySource?.replayOfEventId ?? null,
    deliveryId: built.replaySource?.deliveryId ?? null,
    connectionId: built.replaySource?.connectionId ?? null,
    connectionName: built.replaySource?.connectionName ?? null,
    payload: built.replaySource?.payload ?? null,
    receivedAt: new Date(),
  };

  if (built.kind === 'filtered') {
    const refusal = await beginTriggerHistory({...historyBase, eventRef: randomUUID()});
    await refusal.devFiltered(params.triggerKey, resolved.workflow.id);
    await refusal.discarded();
    recordDevRunMetric(built.triggerKind, 'filtered', definitionSource);
    throw new DevRunTriggerFilteredError(built.reason);
  }

  if (built.kind === 'filter-error') {
    const refusal = await beginTriggerHistory({...historyBase, eventRef: randomUUID()});
    await refusal.devFilterErrored(
      params.triggerKey,
      resolved.workflow.id,
      built.reason,
      built.diagnostic,
    );
    await refusal.allErrored(1);
    recordDevRunMetric(built.triggerKind, 'errored', definitionSource);
    throw new DevRunTriggerFilteredError(built.reason);
  }

  if (built.kind === 'shape-only') {
    throw new Error('Shape-only trigger builds are only valid for dry-run checks');
  }

  const run = await startDevRunAndRecordFailure(params, resolved, built, historyBase, resolvedRef);

  const history = await beginTriggerHistory({...historyBase, eventRef: run.id});
  await history.devTriggered(params.triggerKey, resolved.workflow.id, run);
  recordDevRunMetric(built.triggerKind, 'routed', definitionSource);
  await history.routed(1);
  logger().info(
    {
      workflowRunId: run.id,
      definition_source: definitionSource,
      content_sha256: createHash('sha256')
        .update(resolved.sourceSnapshot.content, 'utf8')
        .digest('hex'),
    },
    'dev run created',
  );
  return {
    id: run.id,
    ref: resolvedRef,
    commit: resolved.commit,
    warnings: resolved.warnings,
  };
}

export interface DevRunCheckResult {
  checkPassed: true;
  triggerKind: DevRunTriggerKind;
  eventChecked: boolean;
  ref: string;
  commit: string;
  warnings: ResolvedDevRunDefinition['warnings'];
}

/**
 * Checks a dev run without starting it. The definition is validated without
 * writing anything, and an integration trigger with a replay event evaluates
 * its filter as dispatch does. No journal entry is recorded.
 */
export async function checkDevRun(params: CreateDevRunParams): Promise<DevRunCheckResult> {
  const validated = await params.definitions.validateDefinitionAtRef({
    workspaceId: params.workspaceId,
    projectId: params.projectId,
    ...(params.ref === undefined ? {} : {ref: params.ref}),
    ...(params.content === undefined ? {} : {content: params.content}),
    ...(params.actions === undefined ? {} : {actions: [...params.actions]}),
    configPath: params.configPath,
    ...(params.commit === undefined ? {} : {expectedCommit: params.commit}),
  });
  if (!validated.valid) throw new DevRunDefinitionInvalidError(validated.errors);

  const trigger = requireTrigger(validated.triggers, params.triggerKey);
  const built = await buildDevRunTrigger(trigger, params, {allowShapeOnly: true});
  recordDevRunMetric(built.triggerKind, 'dry-run', params.content === undefined ? 'ref' : 'local');

  if (built.kind === 'filtered' || built.kind === 'filter-error') {
    throw new DevRunTriggerFilteredError(built.reason);
  }

  return {
    checkPassed: true,
    triggerKind: built.triggerKind,
    eventChecked: built.eventChecked,
    ref: validated.ref,
    commit: validated.commit,
    warnings: validated.warnings,
  };
}

async function prepareDevRun(params: CreateDevRunParams): Promise<DevRunPreparation> {
  const resolved = await params.definitions.resolveDefinitionAtRef({
    projectId: params.projectId,
    ...(params.ref === undefined ? {} : {ref: params.ref}),
    ...(params.content === undefined ? {} : {content: params.content}),
    ...(params.actions === undefined ? {} : {actions: [...params.actions]}),
    configPath: params.configPath,
    ...(params.commit === undefined ? {} : {expectedCommit: params.commit}),
  });
  const definitionSource = params.content === undefined ? 'ref' : 'local';
  const resolvedRef = resolved.ref ?? params.ref ?? missingResolvedRef();
  const trigger = requireTrigger(resolved.triggers, params.triggerKey);

  return {
    resolved,
    built: await buildDevRunTrigger(trigger, params, {}),
    definitionSource,
    resolvedRef,
    triggerSource: trigger.source,
  };
}

/** Answers `trigger-not-found` with the keys the definition does declare. */
export function requireTrigger(
  triggers: Record<string, TriggerDto>,
  triggerKey: string,
): TriggerDto {
  const trigger = Object.hasOwn(triggers, triggerKey) ? triggers[triggerKey] : undefined;
  if (!trigger) throw new DevRunTriggerNotFoundError(triggerKey, Object.keys(triggers));
  return trigger;
}

async function startDevRunAndRecordFailure(
  params: CreateDevRunParams,
  resolved: ResolvedDevRunDefinition,
  built: BuiltDevRunTrigger,
  historyBase: Omit<Parameters<typeof beginTriggerHistory>[0], 'eventRef'>,
  resolvedRef: string,
): Promise<{id: string; name: string}> {
  try {
    return await params.workflows.startDevRun({
      workspaceId: params.workspaceId,
      projectId: params.projectId,
      workflowId: resolved.workflow.id,
      model: resolved.model,
      sourceSnapshot: resolved.sourceSnapshot,
      devSource: {
        ref: resolvedRef,
        commit: resolved.commit,
        configPath: params.configPath,
        definitionSource: params.content === undefined ? 'ref' : 'local',
        localActions: (params.actions ?? []).map((action) => action.path),
        initiatedByUserId: params.userId,
        ...(built.replaySource === undefined
          ? {}
          : {replayOfEventId: built.replaySource.replayOfEventId}),
      },
      ...(built.triggerConnectionId === undefined
        ? {}
        : {triggerConnectionId: built.triggerConnectionId}),
      triggerPayload: built.triggerPayload,
      ...(built.inputs === undefined ? {} : {inputs: built.inputs}),
    });
  } catch (error) {
    const failure = await beginTriggerHistory({...historyBase, eventRef: randomUUID()});
    await failure.devDispatchErrored(
      params.triggerKey,
      resolved.workflow.id,
      toReason(error),
      startDevRunDiagnostic(error),
    );
    if (isPermanentStartDevRunError(error)) {
      recordDevRunMetric(
        built.triggerKind,
        'errored',
        params.content === undefined ? 'ref' : 'local',
      );
      await failure.allErrored(1);
    } else {
      recordDevRunMetric(
        built.triggerKind,
        'failed',
        params.content === undefined ? 'ref' : 'local',
      );
      await failure.failed(1);
    }
    throw error;
  }
}

function missingResolvedRef(): never {
  throw new Error('Definition resolution did not return a ref');
}

function recordDevRunMetric(
  triggerKind: DevRunTriggerKind,
  outcome: 'routed' | 'errored' | 'failed' | 'filtered' | 'dry-run',
  definitionSource: 'ref' | 'local',
): void {
  devRunsCount.add(1, {
    trigger_kind: triggerKind,
    outcome,
    definition_source: definitionSource,
  });
}

interface ReplaySource {
  provider: string;
  deliveryId: string;
  connectionId: string | null;
  connectionName: string | null;
  payload: Record<string, unknown>;
  replayOfEventId: string;
}

interface DevRunTriggerBase {
  triggerKind: DevRunTriggerKind;
  event: string;
  eventChecked: boolean;
  /** Replay-only: journal identity taken from the source event row. */
  replaySource?: ReplaySource | undefined;
}

interface BuiltDevRunTrigger extends DevRunTriggerBase {
  kind: 'run';
  triggerPayload: Parameters<WorkflowsModuleClient['startDevRun']>[0]['triggerPayload'];
  inputs: Record<string, unknown> | undefined;
  /** Replay-only: the connection the source event was received on. */
  triggerConnectionId?: string | undefined;
}

interface FilteredDevRunTrigger extends DevRunTriggerBase {
  kind: 'filtered';
  reason: string;
}

interface FilterErrorDevRunTrigger extends DevRunTriggerBase {
  kind: 'filter-error';
  reason: string;
  diagnostic: Extract<
    ReturnType<typeof evaluateTriggerFilter>,
    {kind: 'filter-error'}
  >['diagnostic'];
}

interface ShapeOnlyDevRunTrigger extends DevRunTriggerBase {
  kind: 'shape-only';
}

type DevRunTriggerBuild =
  | BuiltDevRunTrigger
  | FilteredDevRunTrigger
  | FilterErrorDevRunTrigger
  | ShapeOnlyDevRunTrigger;

function buildDevRunTrigger(
  trigger: TriggerDto,
  params: Pick<CreateDevRunParams, 'inputs' | 'replayEventId' | 'userId' | 'workspaceId'>,
  options: {allowShapeOnly?: boolean},
): DevRunTriggerBuild | Promise<DevRunTriggerBuild> {
  if (trigger.source === 'manual') {
    if (params.replayEventId !== undefined) {
      throw new DevRunReplayEventNotAllowedError(trigger.source);
    }
    // Request inputs override the trigger's `with` block, as fire-manual does.
    return {
      kind: 'run',
      triggerKind: 'manual',
      eventChecked: true,
      triggerPayload: {
        provider: 'manual',
        source: 'manual',
        event: 'fire',
        userId: params.userId,
      },
      inputs: params.inputs ?? trigger.with,
      event: trigger.event ?? 'fire',
    };
  }
  if (trigger.source === 'cron') {
    if (params.replayEventId !== undefined) {
      throw new DevRunReplayEventNotAllowedError(trigger.source);
    }
    if (params.inputs !== undefined) {
      throw new DevRunInputsNotAllowedError();
    }
    return {
      kind: 'run',
      triggerKind: 'cron',
      eventChecked: true,
      triggerPayload: {provider: 'cron', source: 'cron', event: 'tick'},
      inputs: trigger.with,
      event: trigger.event ?? 'tick',
    };
  }
  return buildReplayTrigger(trigger, params, options);
}

function buildMissingReplayEventTrigger(
  trigger: TriggerDto,
  options: {allowShapeOnly?: boolean},
): ShapeOnlyDevRunTrigger {
  if (options.allowShapeOnly) {
    return {
      kind: 'shape-only',
      triggerKind: 'replay',
      event: trigger.event ?? trigger.source,
      eventChecked: false,
    };
  }
  throw new DevRunReplayEventRequiredError(trigger.source);
}

async function buildReplayTrigger(
  trigger: TriggerDto,
  params: Pick<CreateDevRunParams, 'inputs' | 'replayEventId' | 'workspaceId'>,
  options: {allowShapeOnly?: boolean},
): Promise<DevRunTriggerBuild> {
  if (params.inputs !== undefined) {
    throw new DevRunInputsNotAllowedError();
  }
  if (params.replayEventId === undefined) {
    return buildMissingReplayEventTrigger(trigger, options);
  }

  const sourceEvent = await getTriggerEventById(params.replayEventId);
  // A missing row and a row in another workspace answer identically: the id
  // is a uuid with no workspace scoping, so the 404 must not leak existence.
  if (!sourceEvent || sourceEvent.workspaceId !== params.workspaceId) {
    throw new DevRunReplayEventNotFoundError(params.replayEventId);
  }

  // The filter is evaluated exactly as dispatch does: same predicate context,
  // same fail-closed semantics, no override. A false result or an evaluation
  // error refuses the replay with the reason. The orchestrator records the
  // refusal as a terminal dev journal entry.
  const match = matchTriggerEvent({trigger, event: sourceEvent});
  if (match.result === 'event-mismatch') {
    throw new DevRunReplayEventMismatchError(params.replayEventId, {
      eventSource: sourceEvent.source,
      eventName: sourceEvent.event,
      triggerSource: trigger.source,
      ...(trigger.event === undefined ? {} : {triggerEvent: trigger.event}),
    });
  }
  // `replayable` lists only rows with a stored payload, so a pruned row is a race.
  if (match.result === 'payload-unavailable') {
    throw new DevRunReplayEventUnavailableError(params.replayEventId);
  }

  const {event} = match;
  const replaySource = {
    provider: event.provider,
    deliveryId: event.deliveryId,
    connectionId: event.connectionId,
    connectionName: event.connectionName,
    payload: event.payload,
    replayOfEventId: event.id,
  } satisfies ReplaySource;

  if (match.result === 'filtered') {
    return {
      kind: 'filtered',
      triggerKind: 'replay',
      eventChecked: true,
      event: event.event,
      replaySource,
      reason: 'Trigger filter evaluated to false',
    };
  }
  if (match.result === 'filter-error') {
    return {
      kind: 'filter-error',
      triggerKind: 'replay',
      eventChecked: true,
      event: event.event,
      replaySource,
      reason: match.reason,
      diagnostic: match.diagnostic,
    };
  }

  return {
    kind: 'run',
    triggerKind: 'replay',
    eventChecked: true,
    triggerPayload: {
      provider: event.provider,
      source: event.source,
      event: event.event,
      deliveryId: event.deliveryId,
      data: event.payload,
    },
    // The trigger `with` block supplies run inputs, as dispatch passes the
    // subscription's `with` through for integration events.
    inputs: trigger.with,
    event: event.event,
    replaySource,
    triggerConnectionId: event.connectionId ?? undefined,
  };
}
