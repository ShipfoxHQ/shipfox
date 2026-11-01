import {Factory} from 'fishery';
import {type CreateWebConversationParams, createWebConversation} from '#core/conversations.js';
import type {OpenConversation, OpenConversationItem} from '#core/entities/conversation.js';

export const conversationFactory = Factory.define<
  CreateWebConversationParams,
  object,
  {conversation: OpenConversation; item: OpenConversationItem}
>(({sequence, onCreate}) => {
  onCreate((params) => createWebConversation(params));

  return {
    workspaceId: crypto.randomUUID(),
    projectId: crypto.randomUUID(),
    ownerUserId: crypto.randomUUID(),
    clientMessageId: crypto.randomUUID(),
    body: `Message ${sequence}`,
  };
});
