import {requireUserContext, requireWorkspaceAccess} from '@shipfox/api-auth-context';
import type {ProjectsModuleClient} from '@shipfox/api-projects-dto/inter-module';
import {ClientError, type FastifyRequest} from '@shipfox/node-fastify';
import type {Conversation} from '#core/entities/conversation.js';
import {
  AgentSessionUnavailableError,
  ConversationNotFoundError,
  ConversationRetryUnavailableError,
  ConversationTurnRunningError,
} from '#core/errors.js';
import {loadWebConversation} from '#db/conversations.js';

function conversationNotFound(cause?: unknown): ClientError {
  return new ClientError('Conversation not found', 'conversation-not-found', {
    status: 404,
    cause,
  });
}

export async function requireProjectAccess(
  request: FastifyRequest,
  projectId: string,
  projects: ProjectsModuleClient,
) {
  const {project} = await projects.getProjectById({projectId});
  if (project === null) {
    throw new ClientError('Project not found', 'project-not-found', {status: 404});
  }
  return requireWorkspaceAccess({request, workspaceId: project.workspaceId});
}

/**
 * Every `/conversations/:id` route loads through this. Anyone but the owner gets
 * the same 404 as for a conversation that doesn't exist, whatever their role.
 */
export async function requireWebConversation(
  request: FastifyRequest,
  conversationId: string,
): Promise<Conversation> {
  const {userId} = requireUserContext(request);
  const conversation = await loadWebConversation({conversationId, userId});
  if (!conversation) throw conversationNotFound();
  requireWorkspaceAccess({request, workspaceId: conversation.workspaceId});
  return conversation;
}

export function translateConversationRouteError(error: unknown): never {
  if (error instanceof ConversationNotFoundError) throw conversationNotFound(error);
  if (error instanceof ConversationTurnRunningError) {
    throw new ClientError('A turn is running in this conversation', 'conversation-turn-running', {
      status: 409,
      cause: error,
    });
  }
  if (error instanceof ConversationRetryUnavailableError) {
    throw new ClientError(
      'The latest turn did not fail and was not denied',
      'conversation-retry-unavailable',
      {status: 409, cause: error},
    );
  }
  if (error instanceof AgentSessionUnavailableError) {
    throw new ClientError('Conversation is unavailable', 'conversation-unavailable', {
      status: 503,
      details: {reason: error.reason},
      cause: error,
    });
  }
  throw error;
}
