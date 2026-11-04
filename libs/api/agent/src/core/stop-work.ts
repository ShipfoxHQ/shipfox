import {requestScopeTurnStops} from '#db/turn-runtime.js';

export type StopWorkReason = 'project_deleted' | 'workspace_suspended' | 'limit_reached';

export interface StopWorkScope {
  workspaceId: string;
  projectId?: string | undefined;
}

/**
 * Asks every running turn in the scope to stop. `remaining` counts the turns still running, so a
 * caller repeats the call until it reads 0. A deleted project has nobody to read a reply, so its
 * turns post nothing to the provider that started the conversation.
 */
export async function stopWork(params: {
  scope: StopWorkScope;
  reason: StopWorkReason;
}): Promise<{remaining: number}> {
  return await requestScopeTurnStops({
    scope: params.scope,
    suppressReplies: params.reason === 'project_deleted',
  });
}
