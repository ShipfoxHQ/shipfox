import type {
  Interaction,
  InteractionProvider,
  InteractionReplyOutcome,
  InteractionRole,
  ReportInteractionProgressInput,
  SendInteractionReplyInput,
} from '@shipfox/api-integration-spi';
import type {IntegrationConnection} from './entities/connection.js';
import {IntegrationConnectionWorkspaceMismatchError} from './errors.js';
import type {IntegrationProviderRegistry} from './providers/registry.js';

export interface InteractionProviderSummary {
  provider: string;
  interactionEvents: Readonly<Record<string, InteractionRole>>;
  requestContextSchema: Record<string, unknown>;
  replyGuidance: string;
}

export interface IntegrationInteractionService {
  listProviders(): InteractionProviderSummary[];
  readInteraction(input: {
    workspaceId: string;
    connectionId: string;
    event: string;
    payload: unknown;
  }): Promise<Interaction | null>;
  sendReply(
    input: {workspaceId: string; connectionId: string} & Omit<
      SendInteractionReplyInput,
      'connection'
    >,
  ): Promise<InteractionReplyOutcome>;
  /** Returns false when the provider can't show progress. */
  reportProgress(
    input: {workspaceId: string; connectionId: string} & Omit<
      ReportInteractionProgressInput,
      'connection'
    >,
  ): Promise<boolean>;
}

export function createInteractionIntegrationService(params: {
  registry: IntegrationProviderRegistry;
  /** Throws when the connection is missing or inactive. */
  getConnection: (connectionId: string) => Promise<IntegrationConnection>;
}): IntegrationInteractionService {
  const {registry, getConnection} = params;

  async function resolve(
    workspaceId: string,
    connectionId: string,
  ): Promise<{connection: IntegrationConnection; interaction: InteractionProvider}> {
    const connection = await getConnection(connectionId);
    if (connection.workspaceId !== workspaceId) {
      throw new IntegrationConnectionWorkspaceMismatchError(connectionId);
    }
    return {connection, interaction: registry.getAdapter(connection.provider, 'interaction')};
  }

  return {
    listProviders() {
      return registry.list('interaction').flatMap(({provider, adapters}) => {
        const interaction = adapters.interaction;
        return interaction === undefined
          ? []
          : [
              {
                provider,
                interactionEvents: interaction.interactionEvents,
                requestContextSchema: interaction.requestContextSchema,
                replyGuidance: interaction.replyGuidance,
              },
            ];
      });
    },

    async readInteraction({workspaceId, connectionId, event, payload}) {
      const {connection, interaction} = await resolve(workspaceId, connectionId);
      // An event the provider doesn't list never reaches an agent, whatever the provider returns.
      if (!Object.hasOwn(interaction.interactionEvents, event)) return null;
      return (await interaction.readInteraction({connection, event, payload})) ?? null;
    },

    async sendReply({workspaceId, connectionId, ...input}) {
      const {connection, interaction} = await resolve(workspaceId, connectionId);
      return await interaction.sendReply({connection, ...input});
    },

    async reportProgress({workspaceId, connectionId, ...input}) {
      const {connection, interaction} = await resolve(workspaceId, connectionId);
      if (interaction.reportProgress === undefined) return false;
      await interaction.reportProgress({connection, ...input});
      return true;
    },
  };
}
