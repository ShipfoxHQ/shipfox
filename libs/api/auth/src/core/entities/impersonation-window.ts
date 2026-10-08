import type {AdminRole} from '@shipfox/api-auth-dto';

export const MAX_OPEN_IMPERSONATION_WINDOWS = 5;

export type ImpersonationWindowEndedReason = 'stopped' | 'expired';
export type ImpersonationWindowState = 'open' | 'stopped' | 'expired';

export interface ImpersonationWindow {
  id: string;
  actorId: string;
  /** Null for windows opened after windows began targeting a workspace. */
  targetUserId: string | null;
  /** Null for windows opened before windows targeted a workspace; they cannot be continued. */
  workspaceId: string | null;
  reason: string | null;
  actorRoleAtStart: AdminRole;
  startedAt: Date;
  deadlineAt: Date;
  endedAt: Date | null;
  endedReason: ImpersonationWindowEndedReason | null;
}

export type EffectiveImpersonationWindow = ImpersonationWindow & {
  state: ImpersonationWindowState;
};

export function toEffectiveImpersonationWindow(
  window: ImpersonationWindow,
  now: Date,
): EffectiveImpersonationWindow {
  if (window.endedAt === null && window.deadlineAt.getTime() <= now.getTime()) {
    return {
      ...window,
      endedAt: window.deadlineAt,
      endedReason: 'expired',
      state: 'expired',
    };
  }

  if (window.endedReason === 'expired') {
    return {...window, state: 'expired'};
  }

  if (window.endedAt !== null) {
    return {...window, state: 'stopped'};
  }

  return {...window, state: 'open'};
}
