import type {AgentInterModuleClient} from '@shipfox/api-agent-dto/inter-module';
import {
  type IntegrationsModuleClient,
  integrationsInterModuleContract,
} from '@shipfox/api-integration-core-dto/inter-module';
import {isInterModuleKnownError} from '@shipfox/inter-module';
import {logger} from '@shipfox/node-opentelemetry';
import type {TriggerHistoryRecorder} from './record-trigger-history.js';

export type AgentRoutingIntegrations = Pick<
  IntegrationsModuleClient,
  'listInteractionProviders' | 'readInteraction'
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
  /** Agents that took the event, which count as matches next to workflows. */
  engagedCount: number;
  routedCount: number;
  /** A failure that replaying the event may fix. */
  transientError?: {error: unknown} | undefined;
}

export const NOT_ROUTED_TO_AGENT: AgentRoutingState = {engagedCount: 0, routedCount: 0};

// Provider failures can clear on their own. The other declared failures describe a connection
// that replaying the same event can't fix.
function isPermanentReadError(error: unknown): boolean {
  const method = integrationsInterModuleContract.methods.readInteraction;
  return isInterModuleKnownError(method, error) && error.code !== 'provider-failure';
}

/**
 * Hands an event from a connection with the interaction capability to the agent that owns its
 * conversation, or to the default agent. Only the provider decides whether an event is meant for
 * an agent. Routing is idempotent per event, so a replay converges. A failure never touches the
 * workflow fan-out, and a retryable one is returned for the caller to replay.
 */
export async function routeEventToAgent(
  params: RouteEventToAgentParams,
): Promise<AgentRoutingState> {
  const {integrations, agent, history} = params;
  try {
    const {providers} = await integrations.listInteractionProviders({});
    const capability = providers.find(({provider}) => provider === params.provider);
    if (!capability || !Object.hasOwn(capability.interactionEvents, params.event)) {
      return NOT_ROUTED_TO_AGENT;
    }

    const interaction = await integrations.readInteraction({
      workspaceId: params.workspaceId,
      connectionId: params.connectionId,
      event: params.event,
      payload: params.payload,
    });
    if (!interaction) return NOT_ROUTED_TO_AGENT;

    const result = await agent.routeInteraction({
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
    await history.agentRouted(result);
    const routed = result.outcome !== 'dropped';
    return {engagedCount: routed ? 1 : 0, routedCount: routed ? 1 : 0};
  } catch (error) {
    if (isPermanentReadError(error)) {
      logger().warn(
        {err: error, eventRef: params.eventRef, connectionId: params.connectionId},
        'Skipped agent routing for an event whose connection cannot read it',
      );
      return NOT_ROUTED_TO_AGENT;
    }
    return {...NOT_ROUTED_TO_AGENT, transientError: {error}};
  }
}
