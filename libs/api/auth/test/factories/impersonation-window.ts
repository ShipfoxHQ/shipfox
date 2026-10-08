import {Factory} from 'fishery';
import type {ImpersonationWindow} from '#core/entities/impersonation-window.js';
import {db} from '#db/db.js';
import {toImpersonationWindow} from '#db/impersonation-windows.js';
import {impersonationWindows} from '#db/schema/impersonation-windows.js';

export const impersonationWindowFactory = Factory.define<ImpersonationWindow>(
  ({sequence, onCreate, params}) => {
    // Inserts the row directly so a test can also build a window opened before
    // windows targeted a workspace, which the commands no longer create.
    onCreate(async (window) => {
      const rows = await db().insert(impersonationWindows).values(window).returning();
      const row = rows[0];
      if (!row) throw new Error('Impersonation window insert returned no rows');
      return toImpersonationWindow(row);
    });

    const startedAt = params.startedAt ?? new Date();
    const deadlineAt = params.deadlineAt ?? new Date(startedAt.getTime() + 30 * 60 * 1000);

    return {
      id: params.id ?? crypto.randomUUID(),
      actorId: params.actorId ?? crypto.randomUUID(),
      targetUserId: params.targetUserId ?? null,
      workspaceId: params.workspaceId === undefined ? crypto.randomUUID() : params.workspaceId,
      reason: params.reason === undefined ? `Support investigation ${sequence}` : params.reason,
      actorRoleAtStart: params.actorRoleAtStart ?? 'admin-operator',
      startedAt,
      deadlineAt,
      endedAt: params.endedAt ?? null,
      endedReason: params.endedReason ?? null,
    };
  },
);
