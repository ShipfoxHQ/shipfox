import type {AgentInterModuleClient} from '@shipfox/api-agent-dto/inter-module';
import type {IntegrationsModuleClient} from '@shipfox/api-integration-core-dto/inter-module';
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
  /** Whether an agent took the event, which makes the event `routed`. */
  routed: boolean;
  /** A failure that replaying the event may fix. */
  transientError?: {error: unknown} | undefined;
}

export const NOT_ROUTED_TO_AGENT: AgentRoutingState = {routed: false};

/**
 * Hands an event from a connection with the interaction capability to the agent that owns its
 * conversation, or to the default agent. Routing is idempotent per event, so a replay converges.
 * Agents are best-effort next to workflows: an event the provider can't read is skipped, because a
 * replay would delay every later event. Only a failure of the Agent module itself is returned for
 * the caller to replay.
 */
export async function routeEventToAgent(
  params: RouteEventToAgentParams,
): Promise<AgentRoutingState> {
  const interaction = await readInteraction(params);
  if (!interaction) return NOT_ROUTED_TO_AGENT;

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
    return {routed: result.outcome !== 'dropped'};
  } catch (error) {
    return {routed: false, transientError: {error}};
  }
}

async function readInteraction(params: RouteEventToAgentParams) {
  try {
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
  } catch (error) {
    logger().warn(
      {err: error, eventRef: params.eventRef, connectionId: params.connectionId},
      'Skipped agent routing for an event that could not be read',
    );
    return undefined;
  }
}
