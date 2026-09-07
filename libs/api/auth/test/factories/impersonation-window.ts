import {Factory} from 'fishery';
import type {ImpersonationWindow} from '#core/entities/impersonation-window.js';
import {createImpersonationWindow} from '#db/impersonation-windows.js';

export const impersonationWindowFactory = Factory.define<ImpersonationWindow>(
  ({sequence, onCreate, params}) => {
    onCreate(async (window) => await createImpersonationWindow(window));

    const startedAt = params.startedAt ?? new Date();
    const deadlineAt = params.deadlineAt ?? new Date(startedAt.getTime() + 30 * 60 * 1000);

    return {
      id: params.id ?? crypto.randomUUID(),
      actorId: params.actorId ?? crypto.randomUUID(),
      targetUserId: params.targetUserId ?? crypto.randomUUID(),
      reason: params.reason ?? `Support investigation ${sequence}`,
      actorRoleAtStart: params.actorRoleAtStart ?? 'admin-operator',
      startedAt,
      deadlineAt,
      endedAt: params.endedAt ?? null,
      endedReason: params.endedReason ?? null,
    };
  },
);
