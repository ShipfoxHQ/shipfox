import type {ConversationTurnNoticeDto} from '@shipfox/api-agent-dto';
import {
  type ProjectsModuleClient,
  projectsInterModuleContract,
} from '@shipfox/api-projects-dto/inter-module';
import {
  type WorkspacesInterModuleClient,
  workspacesInterModuleContract,
} from '@shipfox/api-workspaces-dto/inter-module';
import {isInterModuleKnownError} from '@shipfox/inter-module';
import type {RequiredAction} from '@shipfox/policy-notice';
import type {Conversation} from './entities/conversation.js';

export type {RequiredAction} from '@shipfox/policy-notice';

export interface AgentAdmissionInput {
  workspaceId: string;
  source: 'agent';
}

export type AgentAdmissionDecision =
  | {allowed: true}
  | {allowed: false; reason: string; requiredAction?: RequiredAction | undefined};

/**
 * The composing application's say on whether a workspace may start an agent turn. Unlike a
 * workflow run, a turn has no definition to name.
 */
export interface AgentAdmissionPolicy {
  admit(input: AgentAdmissionInput): Promise<AgentAdmissionDecision>;
}

export type TurnAdmissionProjects = Pick<ProjectsModuleClient, 'requireProjectForWorkspace'>;

export type TurnAdmissionWorkspaces = Pick<
  WorkspacesInterModuleClient,
  'getWorkspaceOperatingState' | 'listMembershipsForTokenClaims'
>;

/** The host policy must not hold a turn start open indefinitely. */
export const AGENT_ADMISSION_POLICY_TIMEOUT_MS = 5_000;

export const ADMISSION_DENIED_NOTICE_CODE = 'admission-denied';

/**
 * Why a conversation gets no turn. `notice` is what the timeline shows, and its absence means
 * the inputs are settled quietly, because nobody is left to read a notice.
 */
export type TurnRefusal = {notice?: ConversationTurnNoticeDto | undefined};

/** Decides whether the queued inputs of a conversation may open a turn. */
export async function refuseTurn(params: {
  conversation: Conversation;
  workspaces: TurnAdmissionWorkspaces;
  projects: TurnAdmissionProjects;
  policy?: AgentAdmissionPolicy | undefined;
}): Promise<TurnRefusal | undefined> {
  const {conversation, workspaces, projects, policy} = params;

  if (conversation.originKind === 'web' && conversation.ownerUserId !== null) {
    const {memberships} = await workspaces.listMembershipsForTokenClaims({
      userId: conversation.ownerUserId,
    });
    if (!memberships.some((membership) => membership.workspaceId === conversation.workspaceId)) {
      return {};
    }
  }

  const state = await getOperatingState(workspaces, conversation.workspaceId);
  if (state === 'suspended' || state === 'deleted') {
    return {
      notice: {
        code: `workspace-${state}`,
        message: `This workspace is ${state}, so the agent can't reply.`,
        required_action: null,
      },
    };
  }
  // A deleted project has nobody to tell, so its inputs are settled quietly.
  if (!(await projectAdmitsTurns(projects, conversation))) return {};
  if (policy === undefined) return undefined;

  const decision = await admitWithTimeout(policy, {
    workspaceId: conversation.workspaceId,
    source: 'agent',
  });
  if (decision.allowed) return undefined;
  return {
    notice: {
      code: ADMISSION_DENIED_NOTICE_CODE,
      message: decision.requiredAction === undefined ? decision.reason : null,
      required_action: decision.requiredAction ?? null,
    },
  };
}

async function projectAdmitsTurns(
  projects: TurnAdmissionProjects,
  conversation: Conversation,
): Promise<boolean> {
  try {
    await projects.requireProjectForWorkspace({
      workspaceId: conversation.workspaceId,
      projectId: conversation.projectId,
    });
    return true;
  } catch (error) {
    if (
      isInterModuleKnownError(projectsInterModuleContract.methods.requireProjectForWorkspace, error)
    ) {
      return false;
    }
    throw error;
  }
}

async function getOperatingState(
  workspaces: TurnAdmissionWorkspaces,
  workspaceId: string,
): Promise<'active' | 'suspended' | 'deleted'> {
  try {
    return (await workspaces.getWorkspaceOperatingState({workspaceId})).status;
  } catch (error) {
    // A workspace that no longer exists admits nothing, and retrying would never change that.
    if (
      isInterModuleKnownError(
        workspacesInterModuleContract.methods.getWorkspaceOperatingState,
        error,
      ) &&
      error.code === 'workspace-not-found'
    ) {
      return 'deleted';
    }
    throw error;
  }
}

async function admitWithTimeout(
  policy: AgentAdmissionPolicy,
  input: AgentAdmissionInput,
): Promise<AgentAdmissionDecision> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      policy.admit(input),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(
            new Error(
              `Agent admission policy timed out after ${AGENT_ADMISSION_POLICY_TIMEOUT_MS}ms`,
            ),
          );
        }, AGENT_ADMISSION_POLICY_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
