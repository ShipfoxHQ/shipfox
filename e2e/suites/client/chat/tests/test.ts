import {randomUUID} from 'node:crypto';
import type {
  ConversationDetailDto,
  CreateConversationBodyDto,
  CreateConversationResponseDto,
} from '@shipfox/api-agent-dto';
import {createApiClient} from '@shipfox/e2e-core';
import {test as base, expect} from '@shipfox/e2e-core/playwright';
import {type WorkspaceFixtures, workspaceFixtures} from '@shipfox/e2e-kit/fixtures';
import {type ChatScreenFixtures, chatScreens} from '@shipfox/e2e-screens-chat';
import {type AgentFixtures, agentHelper} from '@shipfox/e2e-setup-agent';

/**
 * A turn starts through the conversation's Temporal workflow, which can take several seconds on a
 * busy machine, so every wait for a turn's outcome uses this instead of the default 5 seconds.
 */
export const TURN = {timeout: 30_000};

/** A user's web conversations, through the public API the chat panel calls. */
function createConversationsHelper() {
  return {
    start: async (params: {
      sessionToken: string;
      projectId: string;
      body: string;
    }): Promise<CreateConversationResponseDto> => {
      const json: CreateConversationBodyDto = {client_message_id: randomUUID(), body: params.body};
      return await createApiClient({token: params.sessionToken}).requestJson(
        'post',
        `/projects/${params.projectId}/conversations`,
        {json},
      );
    },
    get: async (params: {
      sessionToken: string;
      conversationId: string;
    }): Promise<ConversationDetailDto> =>
      await createApiClient({token: params.sessionToken}).requestJson(
        'get',
        `/conversations/${params.conversationId}`,
      ),
  };
}

/** Joins a second user to a workspace through an accepted invitation, which grants admin. */
function createMembersHelper(params: Pick<WorkspaceFixtures, 'auth' | 'workspaces'>) {
  return {
    join: async (workspace: {workspaceId: string; userId: string}) => {
      const user = await params.auth.createUser();
      const invitation = await params.workspaces.createInvitation({
        workspaceId: workspace.workspaceId,
        email: user.email,
        invitedByUserId: workspace.userId,
      });
      const session = await params.auth.createSession({user_id: user.user.id});
      await createApiClient({token: session.token}).request('post', '/invitations/accept', {
        json: {token: invitation.raw_token},
      });
      return {user, sessionToken: session.token};
    },
  };
}

export interface ConversationsFixtures {
  conversations: ReturnType<typeof createConversationsHelper>;
  members: ReturnType<typeof createMembersHelper>;
}

export const test = base.extend<
  WorkspaceFixtures & AgentFixtures & ChatScreenFixtures & ConversationsFixtures
>({
  ...workspaceFixtures,
  ...agentHelper,
  ...chatScreens,
  conversations: async ({request: _request}, use) => {
    await use(createConversationsHelper());
  },
  members: async ({auth, workspaces}, use) => {
    await use(createMembersHelper({auth, workspaces}));
  },
});
export {expect};
