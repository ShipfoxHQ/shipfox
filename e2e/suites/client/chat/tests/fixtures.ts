import type {ConversationDetailDto, ListConversationsResponseDto} from '@shipfox/api-agent-dto';
import {createApiClient, E2eApiError, pollUntil} from '@shipfox/e2e-core';
import type {ReadyWorkspace} from '@shipfox/e2e-kit/fixtures';
import type {ScriptedManagedProviderEntry} from '@shipfox/e2e-setup-agent';
import {registerScriptedManagedProvider} from '@shipfox/e2e-setup-agent';
import {createSession, createUser, type E2eCreateUserResponseDto} from '@shipfox/e2e-setup-auth';
import {createInvitation} from '@shipfox/e2e-setup-workspaces';

export const TURN_TIMEOUT_MS = 60_000;

/** The script a project's conversations answer from. Register it before the first message. */
export async function scriptProject(
  workspace: Pick<ReadyWorkspace, 'projectId'>,
  entries: ScriptedManagedProviderEntry[],
): Promise<void> {
  await registerScriptedManagedProvider({projectId: workspace.projectId, entries});
}

/** The latest conversation of the project, as its author reads it. */
export async function latestConversation(
  workspace: Pick<ReadyWorkspace, 'projectId' | 'sessionToken'>,
): Promise<ConversationDetailDto> {
  const client = createApiClient({token: workspace.sessionToken});
  const list = await client.requestJson<ListConversationsResponseDto>(
    'get',
    `/projects/${workspace.projectId}/conversations`,
  );
  const [summary] = list.conversations;
  if (!summary) throw new Error('The project has no conversation');
  return await client.requestJson<ConversationDetailDto>('get', `/conversations/${summary.id}`);
}

/** Polls the conversation until its latest turn has ended with one of the given statuses. */
export async function waitForTurn(
  workspace: Pick<ReadyWorkspace, 'projectId' | 'sessionToken'>,
  statuses: ReadonlyArray<'succeeded' | 'failed' | 'stopped'>,
): Promise<ConversationDetailDto> {
  return await pollUntil(
    {
      timeoutMs: TURN_TIMEOUT_MS,
      intervalMs: 250,
      maxIntervalMs: 2_000,
      backoffFactor: 1.5,
      describe: () => `a conversation turn ending in ${statuses.join(' or ')}`,
    },
    async () => {
      const conversation = await latestConversation(workspace);
      const status = conversation.latest_turn?.status;
      return status !== undefined && statuses.includes(status as (typeof statuses)[number])
        ? conversation
        : null;
    },
  );
}

export interface Member {
  user: E2eCreateUserResponseDto;
  sessionToken: string;
}

/** A second member of the workspace, joined through an invitation. */
export async function inviteMember(
  workspace: Pick<ReadyWorkspace, 'workspaceId' | 'userId'>,
): Promise<Member> {
  const user = await createUser({name: 'Chat Member'});
  const invitation = await createInvitation({
    workspaceId: workspace.workspaceId,
    email: user.email,
    invitedByUserId: workspace.userId,
  });
  const session = await createSession({user_id: user.user.id});
  const client = createApiClient({token: session.token});
  await client.request('post', '/invitations/accept', {json: {token: invitation.raw_token}});
  return {user, sessionToken: session.token};
}

/** The status an API read fails with, or undefined when it succeeds. */
export async function readStatus(token: string, path: string): Promise<number | undefined> {
  const client = createApiClient({token});
  try {
    await client.request('get', path);
    return undefined;
  } catch (error) {
    if (error instanceof E2eApiError) return error.status;
    throw error;
  }
}
