import {randomUUID} from 'node:crypto';
import type {SecretsInterModuleClient} from '@shipfox/api-secrets-dto/inter-module';
import {
  getManualSubscriptionByDefinitionId,
  getTriggerSubscriptionById,
} from '#db/subscriptions.js';
import {
  eventOutcomeCount,
  eventReceivedCount,
  subscriptionTriggeredCount,
} from '#metrics/instance.js';
import {readConfigInputs, readConfigSecretInputs} from './config.js';
import type {TriggerSubscription} from './entities/subscription.js';
import {
  ManualTriggerNotFoundError,
  SecretInputMissingError,
  TriggerSubscriptionNotFoundError,
  TriggerSubscriptionNotManualError,
  TriggerWorkspaceMismatchError,
} from './errors.js';
import {
  pinSecretInputs,
  type SecretInputReference,
  type SecretInputSource,
} from './pin-secret-inputs.js';
import {beginTriggerHistory, toReason} from './record-trigger-history.js';
import {
  isPermanentStartRunError,
  startRunDiagnostic,
  type WorkflowsModuleClient,
} from './workflows-client.js';

export interface FireManualTriggerParams {
  workflows: WorkflowsModuleClient;
  secrets?: Pick<SecretsInterModuleClient, 'getSecret'> | undefined;
  workspaceId: string;
  definitionId: string;
  userId?: string | undefined;
  parentRun?: {runId: string} | undefined;
  inputs?: Record<string, unknown> | undefined;
  secretInputs?: Record<string, SecretInputSource> | undefined;
  idempotencyKey?: string | undefined;
}

export interface FireManualSubscriptionParams {
  workflows: WorkflowsModuleClient;
  secrets?: Pick<SecretsInterModuleClient, 'getSecret'> | undefined;
  subscriptionId: string;
  callerWorkspaceId: string;
  userId?: string | undefined;
  parentRun?: {runId: string} | undefined;
  inputs?: Record<string, unknown> | undefined;
  secretInputs?: Record<string, SecretInputSource> | undefined;
  idempotencyKey?: string | undefined;
}

export async function fireManualTrigger(
  params: FireManualTriggerParams,
): Promise<{id: string; name: string; deduplicated: boolean}> {
  assertExactlyOneManualTriggerCaller(params);

  const subscription = await getManualSubscriptionByDefinitionId(params.definitionId);
  if (!subscription || subscription.workspaceId !== params.workspaceId) {
    throw new ManualTriggerNotFoundError(params.definitionId);
  }

  const run = await fireManualSubscription({
    workflows: params.workflows,
    secrets: params.secrets,
    subscriptionId: subscription.id,
    callerWorkspaceId: params.workspaceId,
    userId: params.userId,
    parentRun: params.parentRun,
    inputs: params.inputs,
    secretInputs: params.secretInputs,
    idempotencyKey: params.idempotencyKey,
  });
  return {...run, deduplicated: run.deduplicated === true};
}

export async function fireManualSubscription(
  params: FireManualSubscriptionParams,
): Promise<{id: string; name: string; deduplicated?: boolean}> {
  assertExactlyOneManualTriggerCaller(params);

  const subscription = await getTriggerSubscriptionById(params.subscriptionId);
  if (!subscription) throw new TriggerSubscriptionNotFoundError(params.subscriptionId);
  if (subscription.source !== 'manual') {
    throw new TriggerSubscriptionNotManualError(params.subscriptionId, subscription.source);
  }
  // Defence in depth: unreachable from the HTTP route, but required for any direct caller.
  if (subscription.workspaceId !== params.callerWorkspaceId) {
    throw new TriggerWorkspaceMismatchError(
      params.subscriptionId,
      subscription.workspaceId,
      params.callerWorkspaceId,
    );
  }

  // Manual fires have no upstream event id. Use the run id after success; failed
  // attempts need a synthesized ref because there is no run to key on.
  const origin = params.parentRun === undefined ? ('manual' as const) : ('workflow' as const);
  const historyBase = {
    origin,
    workspaceId: subscription.workspaceId,
    provider: null,
    source: subscription.source,
    // Manual triggers have no inbound event. Keep the canonical history event
    // for a row that bypassed the projection write-path validation.
    event: subscription.event ?? 'fire',
    replayOfEventId: null,
    deliveryId: null,
    connectionId: null,
    connectionName: null,
    payload: null,
    receivedAt: new Date(),
  };

  eventReceivedCount.add(1, {origin, provider: 'manual'});

  const inputs = params.inputs ?? readConfigInputs(subscription);
  let run: {id: string; name: string};
  try {
    const secretInputs = await resolveManualSecretInputs(
      params,
      subscription.projectId,
      subscription,
    );
    run = await params.workflows.startRunFromTrigger({
      workspaceId: subscription.workspaceId,
      projectId: subscription.projectId,
      definitionId: subscription.workflowDefinitionId,
      triggerPayload: {
        provider: 'manual',
        source: 'manual',
        event: 'fire',
        subscriptionId: subscription.id,
        ...(params.userId === undefined ? {} : {userId: params.userId}),
        ...(params.parentRun === undefined ? {} : {parentRun: params.parentRun}),
      },
      ...(inputs === undefined ? {} : {inputs}),
      ...optionalSecretInputs(secretInputs),
      ...(params.parentRun === undefined ? {} : {parentRun: params.parentRun}),
      idempotencyKey: params.idempotencyKey ?? randomUUID(),
    });
  } catch (error) {
    const failure = await beginTriggerHistory({...historyBase, eventRef: randomUUID()});
    await failure.dispatchErrored(subscription, toReason(error), startRunDiagnostic(error));
    if (isPermanentStartRunError(error)) {
      eventOutcomeCount.add(1, {origin, provider: 'manual', outcome: 'errored'});
      await failure.allErrored(1);
    } else {
      eventOutcomeCount.add(1, {origin, provider: 'manual', outcome: 'failed'});
      await failure.failed(1);
    }
    throw error;
  }

  const history = await beginTriggerHistory({...historyBase, eventRef: run.id});
  await history.triggered(subscription, run);
  subscriptionTriggeredCount.add(1, {origin, provider: 'manual'});
  eventOutcomeCount.add(1, {origin, provider: 'manual', outcome: 'routed'});
  await history.routed(1);
  return run;
}

async function resolveManualSecretInputs(
  params: FireManualSubscriptionParams,
  resolutionProjectId: string | null,
  subscription: TriggerSubscription,
): Promise<Record<string, SecretInputReference> | undefined> {
  const defaults = readConfigSecretInputs(subscription);
  const secretInputs =
    params.secretInputs === undefined
      ? defaults
      : validateSecretInputOverride(params.secretInputs, defaults);
  return await resolveSecretInputs(params, resolutionProjectId, secretInputs);
}

async function resolveSecretInputs(
  params: FireManualSubscriptionParams,
  resolutionProjectId: string | null,
  secretInputs: Record<string, SecretInputSource> | Record<string, string> | undefined,
): Promise<Record<string, SecretInputReference> | undefined> {
  if (secretInputs === undefined) return undefined;
  if (params.secrets === undefined) {
    throw new TypeError('A Secrets client is required when secret inputs are supplied');
  }

  return await pinSecretInputs({
    secrets: params.secrets,
    workspaceId: params.callerWorkspaceId,
    resolutionProjectId,
    secretInputs,
  });
}

function validateSecretInputOverride(
  secretInputs: Record<string, SecretInputSource>,
  defaults: Record<string, string> | undefined,
): Record<string, SecretInputSource> {
  if (defaults !== undefined) {
    for (const name of Object.keys(defaults)) {
      if (!Object.hasOwn(secretInputs, name)) throw new SecretInputMissingError(name);
    }
  }
  return secretInputs;
}

function optionalSecretInputs(secretInputs: Record<string, SecretInputReference> | undefined): {
  secretInputs?: Record<string, SecretInputReference>;
} {
  return secretInputs === undefined ? {} : {secretInputs};
}

function assertExactlyOneManualTriggerCaller(
  params: Pick<FireManualTriggerParams, 'userId' | 'parentRun'>,
): void {
  const hasUserId = params.userId !== undefined;
  const hasParentRun = params.parentRun !== undefined;
  if (hasUserId === hasParentRun) {
    throw new TypeError('Exactly one of userId or parentRun must be provided');
  }
}
