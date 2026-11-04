import type {IntegrationsModuleClient} from '@shipfox/api-integration-core-dto/inter-module';
import {logger} from '@shipfox/node-opentelemetry';
import {getConversationById} from '#db/turn-runtime.js';

/**
 * Puts a started run's link on the surface of an integration conversation, such as a Linear
 * agent session. The run is already started and linked, so a failure here is logged.
 */
export async function reportConversationRunLink(params: {
  conversationId: string;
  link: {label: string; url: string};
  integrations: Pick<IntegrationsModuleClient, 'reportInteractionProgress'>;
}): Promise<void> {
  try {
    const conversation = await getConversationById(params.conversationId);
    if (
      conversation?.originKind !== 'integration' ||
      conversation.originConnectionId === null ||
      conversation.originKey === null
    ) {
      return;
    }
    await params.integrations.reportInteractionProgress({
      workspaceId: conversation.workspaceId,
      connectionId: conversation.originConnectionId,
      conversationKey: conversation.originKey,
      state: 'working',
      links: [params.link],
    });
  } catch (error) {
    logger().warn(
      {err: error, conversationId: params.conversationId},
      'Failed to report the run link of an agent conversation',
    );
  }
}
