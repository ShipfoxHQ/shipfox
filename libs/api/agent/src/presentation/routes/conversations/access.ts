import {requireUserContext, requireWorkspaceAccess} from '@shipfox/api-auth-context';
import type {DefinitionsInterModuleClient} from '@shipfox/api-definitions-dto/inter-module';
import type {ProjectsModuleClient} from '@shipfox/api-projects-dto/inter-module';
import {ClientError, type FastifyRequest} from '@shipfox/node-fastify';
import type {Conversation} from '#core/entities/conversation.js';
import {
  AgentSessionUnavailableError,
  ConversationNotFoundError,
  ConversationRetryUnavailableError,
  ConversationTurnRunningError,
  ProjectAgentNotFoundError,
} from '#core/errors.js';
import {resolveProjectAgent} from '#core/project-agents.js';
import {SHIPPY_AGENT_KEY} from '#core/shippy.js';
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

/**
 * A conversation stays with the agent it was created with. When that custom agent is gone, the
 * conversation is still readable, but it takes no new input.
 */
export async function requireConversationAgent(
  conversation: Conversation,
  definitions: DefinitionsInterModuleClient | undefined,
): Promise<void> {
  if (conversation.agentKey === SHIPPY_AGENT_KEY) return;
  try {
    await resolveProjectAgent({
      definitions,
      workspaceId: conversation.workspaceId,
      projectId: conversation.projectId,
      key: conversation.agentKey,
    });
  } catch (error) {
    if (!(error instanceof ProjectAgentNotFoundError)) throw error;
    throw new ClientError(
      'The agent of this conversation no longer exists',
      'conversation-agent-unavailable',
      {status: 409, cause: error},
    );
  }
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
  if (error instanceof ProjectAgentNotFoundError) {
    throw new ClientError('Agent not found in this project', 'agent-not-found', {
      status: 422,
      details: {agent_key: error.agentKey},
      cause: error,
    });
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
