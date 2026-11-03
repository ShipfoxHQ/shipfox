import {
  type AgentInterModuleClient,
  MAX_CONVERSATION_KEY_LENGTH,
} from '@shipfox/api-agent-dto/inter-module';
import {
  type IntegrationsModuleClient,
  integrationsInterModuleContract,
} from '@shipfox/api-integration-core-dto/inter-module';
import {isInterModuleKnownError} from '@shipfox/inter-module';
import {logger} from '@shipfox/node-opentelemetry';
import type {TriggerHistoryRecorder} from './record-trigger-history.js';

export type AgentRoutingIntegrations = Pick<
  IntegrationsModuleClient,
  'listInteractionProviders' | 'readInteraction' | 'reportInteractionProgress'
>;
export type AgentRoutingClient = Pick<AgentInterModuleClient, 'routeInteraction'>;

export interface RouteEventToAgentParams {
  integrations: AgentRoutingIntegrations;
  agent: AgentRoutingClient;
  history: Pick<TriggerHistoryRecorder, 'agentRouted'>;
  eventRef: string;
  workspaceId: string;
  connectionId: string;
  provider: string;
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
 * conversation, or to the default agent. Routing is idempotent per event, so a replay converges.
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
    });
    await params.history.agentRouted(result);
    if (result.outcome === 'dropped') {
      if (interaction.role === 'request') await clearProgress(params, interaction.conversationKey);
      return NOT_ROUTED_TO_AGENT;
    }
    return {routed: true};
  } catch (error) {
    return {routed: false, transientError: {error}};
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
