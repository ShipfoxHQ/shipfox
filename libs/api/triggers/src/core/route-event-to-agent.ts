import {
  type AgentInterModuleClient,
  type InteractionRoutingResult,
  MAX_CONVERSATION_KEY_LENGTH,
} from '@shipfox/api-agent-dto/inter-module';
import {
  type IntegrationsModuleClient,
  integrationsInterModuleContract,
} from '@shipfox/api-integration-core-dto/inter-module';
import {isInterModuleKnownError} from '@shipfox/inter-module';
import {logger} from '@shipfox/node-opentelemetry';
import {findAgentSubscriptionsBySource} from '#db/agent-subscriptions.js';
import {evaluateStoredFilter} from './config.js';
import type {AgentSubscription} from './entities/agent-subscription.js';
import type {TriggerDecisionDiagnostic} from './entities/diagnostic.js';
import type {TriggerHistoryRecorder} from './record-trigger-history.js';

export type AgentRoutingIntegrations = Pick<
  IntegrationsModuleClient,
  'listInteractionProviders' | 'readInteraction' | 'reportInteractionProgress'
>;
export type AgentRoutingClient = Pick<AgentInterModuleClient, 'routeInteraction'>;

export interface RouteEventToAgentParams {
  integrations: AgentRoutingIntegrations;
  agent: AgentRoutingClient;
  history: Pick<TriggerHistoryRecorder, 'agentRouted' | 'agentMatched' | 'agentFilterErrored'>;
  eventRef: string;
  workspaceId: string;
  connectionId: string;
  provider: string;
  /** The connection's slug, which agent rules name. */
  source: string;
  event: string;
  payload: unknown;
}

export interface AgentRoutingState {
  /** Whether an agent took the event, which makes the event `routed`. */
  routed: boolean;
  /** A failure that replaying the event may fix. */
  transientError?: {error: unknown} | undefined;
}

export const NOT_ROUTED_TO_AGENT: AgentRoutingState = {routed: false};

/**
 * Hands an event from a connection with the interaction capability to the agent that owns its
 * conversation. A request also carries the agents whose `on:` rules match it, and Agent picks the
 * one that answers, or the default agent. Routing is idempotent per event, so a replay converges.
 * Agents are best-effort next to workflows. A failure the Integrations module declares for the
 * read, such as a provider outage or an inactive connection, skips the event, because a replay
 * would delay every later event and an acknowledgment window is gone by then. Any other failure,
 * including the Agent module's, is returned for the caller to replay.
 */
export async function routeEventToAgent(
  params: RouteEventToAgentParams,
): Promise<AgentRoutingState> {
  let interaction: Awaited<ReturnType<typeof readInteraction>>;
  try {
    interaction = await readInteraction(params);
  } catch (error) {
    if (!isInterModuleKnownError(integrationsInterModuleContract.methods.readInteraction, error)) {
      return {routed: false, transientError: {error}};
    }
    logger().warn(
      {err: error, eventRef: params.eventRef, connectionId: params.connectionId},
      'Skipped agent routing for an event that could not be read',
    );
    return NOT_ROUTED_TO_AGENT;
  }
  if (!interaction) return NOT_ROUTED_TO_AGENT;
  if (interaction.conversationKey.length > MAX_CONVERSATION_KEY_LENGTH) {
    logger().warn(
      {eventRef: params.eventRef, connectionId: params.connectionId},
      'Skipped agent routing for an interaction whose key is too long',
    );
    return NOT_ROUTED_TO_AGENT;
  }

  let matching: RuleMatching = NO_RULE_MATCHED;
  if (interaction.role === 'request') {
    try {
      matching = await matchAgentRules({...params, context: interaction.context});
    } catch (error) {
      return {routed: false, transientError: {error}};
    }
  }

  try {
    const result = await params.agent.routeInteraction({
      workspaceId: params.workspaceId,
      connectionId: params.connectionId,
      provider: params.provider,
      deliveryKey: params.eventRef,
      interaction: {
        conversationKey: interaction.conversationKey,
        role: interaction.role,
        text: interaction.text,
        ...(interaction.author ? {author: interaction.author} : {}),
      },
      candidates: matching.matched.map((subscription) => ({
        subscriptionId: subscription.id,
        projectId: subscription.projectId,
        agentKey: subscription.agentKey,
        boundAt: subscription.createdAt.toISOString(),
      })),
    });
    await recordRouting({params, matching, result});
    if (result.outcome === 'dropped') {
      if (interaction.role === 'request') await clearProgress(params, interaction.conversationKey);
      return NOT_ROUTED_TO_AGENT;
    }
    return {routed: true};
  } catch (error) {
    return {routed: false, transientError: {error}};
  }
}

interface RuleMatching {
  matched: AgentSubscription[];
  errored: {
    subscription: AgentSubscription;
    reason: string;
    diagnostic: TriggerDecisionDiagnostic;
  }[];
}

const NO_RULE_MATCHED: RuleMatching = {matched: [], errored: []};

/** Evaluates the rules on the event's source. The filter reads `request` and `event`. */
async function matchAgentRules(
  params: RouteEventToAgentParams & {context: Record<string, unknown>},
): Promise<RuleMatching> {
  const subscriptions = await findAgentSubscriptionsBySource({
    workspaceId: params.workspaceId,
    source: params.source,
  });
  const matching: RuleMatching = {matched: [], errored: []};
  for (const subscription of subscriptions) {
    const result = evaluateStoredFilter({
      value: subscription.filter,
      context: {request: params.context, event: params.payload},
      invalidReason: 'Agent rule filter must be a non-empty string when set',
      evaluationFailedReason: 'Agent rule filter evaluation failed',
      invalidDiagnosticCode: 'filter-config-invalid',
    });
    if (result.kind === 'matched') matching.matched.push(subscription);
    if (result.kind === 'filter-error') {
      matching.errored.push({subscription, reason: result.reason, diagnostic: result.diagnostic});
    }
  }
  return matching;
}

/**
 * Records the routing result. A request on an owned key never reached the rules, so their matches
 * and errors are left out.
 */
async function recordRouting(args: {
  params: RouteEventToAgentParams;
  matching: RuleMatching;
  result: InteractionRoutingResult;
}): Promise<void> {
  const {params, matching, result} = args;
  if (result.outcome === 'matched') {
    const byId = new Map(matching.matched.map((subscription) => [subscription.id, subscription]));
    const owner = byId.get(result.subscriptionId);
    if (owner) {
      const ambiguous = result.ambiguousSubscriptionIds.flatMap((id) => byId.get(id) ?? []);
      await params.history.agentMatched(owner, ambiguous);
    }
  } else {
    await params.history.agentRouted(result);
  }
  if (result.outcome === 'owner') return;
  for (const {subscription, reason, diagnostic} of matching.errored) {
    await params.history.agentFilterErrored(subscription, reason, diagnostic);
  }
}

/**
 * A provider may show the request as in progress before routing. No turn starts for a dropped
 * request, so nothing else would clear it. Best-effort, because the drop is already recorded.
 */
async function clearProgress(
  params: RouteEventToAgentParams,
  conversationKey: string,
): Promise<void> {
  try {
    await params.integrations.reportInteractionProgress({
      workspaceId: params.workspaceId,
      connectionId: params.connectionId,
      conversationKey,
      state: 'idle',
    });
  } catch (error) {
    logger().warn(
      {err: error, eventRef: params.eventRef, connectionId: params.connectionId},
      'Failed to clear the progress of a dropped agent request',
    );
  }
}

async function readInteraction(params: RouteEventToAgentParams) {
  const {providers} = await params.integrations.listInteractionProviders({});
  const capability = providers.find(({provider}) => provider === params.provider);
  if (!capability || !Object.hasOwn(capability.interactionEvents, params.event)) {
    return undefined;
  }
  return await params.integrations.readInteraction({
    workspaceId: params.workspaceId,
    connectionId: params.connectionId,
    event: params.event,
    payload: params.payload,
  });
}
