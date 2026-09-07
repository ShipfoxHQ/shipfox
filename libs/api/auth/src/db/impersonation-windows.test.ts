import {withPostgresSession} from '@shipfox/node-postgres';
import {and, eq, lte} from 'drizzle-orm';
import {ImpersonationWindowLimitReachedError} from '#core/errors.js';
import {impersonationWindowFactory, userFactory} from '#test/index.js';
import {lockAdminOwnerGrants, lockImpersonationWindowActor} from './admin-command.js';
import {db} from './db.js';
import {
  countOpenImpersonationWindows,
  createImpersonationWindow,
  findImpersonationWindow,
  getEffectiveImpersonationWindow,
  listImpersonationWindowsByTarget,
  listOpenImpersonationWindows,
  materializeImpersonationWindowExpiry,
  requireImpersonationWindowCapacity,
  stopImpersonationWindow,
} from './impersonation-windows.js';
import {impersonationWindows} from './schema/impersonation-windows.js';

describe('impersonation windows db', () => {
  test('persists only inert window metadata and derives effective expiry', async () => {
    const actor = await userFactory.create({emailVerifiedAt: new Date()});
    const target = await userFactory.create({emailVerifiedAt: new Date()});
    const startedAt = new Date('2026-01-01T00:00:00.000Z');
    const deadlineAt = new Date('2026-01-01T00:30:00.000Z');

    const window = await createImpersonationWindow({
      actorId: actor.id,
      targetUserId: target.id,
      reason: 'Investigate a support report',
      actorRoleAtStart: 'admin-owner',
      startedAt,
      deadlineAt,
    });

    const rows = await db()
      .select()
      .from(impersonationWindows)
      .where(eq(impersonationWindows.id, window.id));
    expect(rows).toHaveLength(1);
    expect(Object.keys(rows[0] ?? {}).sort()).toEqual([
      'actorId',
      'actorRoleAtStart',
      'deadlineAt',
      'endedAt',
      'endedReason',
      'id',
      'reason',
      'startedAt',
      'targetUserId',
    ]);

    await expect(
      getEffectiveImpersonationWindow({
        id: window.id,
        now: new Date('2026-01-01T00:29:59.999Z'),
      }),
    ).resolves.toMatchObject({state: 'open', endedAt: null, endedReason: null});

    await expect(
      getEffectiveImpersonationWindow({id: window.id, now: deadlineAt}),
    ).resolves.toMatchObject({
      state: 'expired',
      endedAt: deadlineAt,
      endedReason: 'expired',
    });

    const storedBeforeMaterialization = await findImpersonationWindow({id: window.id});
    expect(storedBeforeMaterialization).toMatchObject({endedAt: null, endedReason: null});

    await expect(
      materializeImpersonationWindowExpiry({id: window.id, now: deadlineAt}),
    ).resolves.toMatchObject({
      endedAt: deadlineAt,
      endedReason: 'expired',
    });

    const storedAfterMaterialization = await findImpersonationWindow({id: window.id});
    expect(storedAfterMaterialization).toMatchObject({
      endedAt: deadlineAt,
      endedReason: 'expired',
    });
  });

  test('materializes expiry before a late stop', async () => {
    const actor = await userFactory.create({emailVerifiedAt: new Date()});
    const target = await userFactory.create({emailVerifiedAt: new Date()});
    const deadlineAt = new Date('2026-01-01T00:30:00.000Z');
    const capturedAt = new Date('2026-01-01T00:31:00.000Z');

    const window = await createImpersonationWindow({
      actorId: actor.id,
      targetUserId: target.id,
      reason: 'Investigate a support report',
      actorRoleAtStart: 'admin-owner',
      startedAt: new Date('2026-01-01T00:00:00.000Z'),
      deadlineAt,
    });

    await expect(
      stopImpersonationWindow({id: window.id, endedAt: capturedAt, now: capturedAt}),
    ).resolves.toMatchObject({endedAt: deadlineAt, endedReason: 'expired'});

    const stored = await findImpersonationWindow({id: window.id});
    expect(stored).toMatchObject({endedAt: deadlineAt, endedReason: 'expired'});

    await expect(
      getEffectiveImpersonationWindow({id: window.id, now: capturedAt}),
    ).resolves.toMatchObject({
      state: 'expired',
      endedAt: deadlineAt,
      endedReason: 'expired',
    });
  });

  test('uses stable started-at and id pagination for owned windows and target lookup', async () => {
    const actor = await userFactory.create({emailVerifiedAt: new Date()});
    const target = await userFactory.create({emailVerifiedAt: new Date()});
    const startedAt = new Date('2026-01-01T00:00:00.000Z');
    const deadlineAt = new Date('2026-01-01T00:30:00.000Z');
    const ids = [
      '00000000-0000-0000-0000-000000000001',
      '00000000-0000-0000-0000-000000000002',
      '00000000-0000-0000-0000-000000000003',
    ];

    for (const id of ids) {
      await impersonationWindowFactory.create({
        id,
        actorId: actor.id,
        targetUserId: target.id,
        startedAt,
        deadlineAt,
      });
    }

    const firstPage = await listOpenImpersonationWindows({
      actorId: actor.id,
      now: new Date('2026-01-01T00:01:00.000Z'),
      limit: 2,
    });
    expect(firstPage.rows.map(({id}) => id)).toEqual([ids[2], ids[1]]);
    expect(firstPage.nextCursor).toEqual({createdAt: startedAt, id: ids[1]});

    const secondPage = await listOpenImpersonationWindows({
      actorId: actor.id,
      now: new Date('2026-01-01T00:01:00.000Z'),
      limit: 2,
      cursor: firstPage.nextCursor ?? undefined,
    });
    expect(secondPage.rows.map(({id}) => id)).toEqual([ids[0]]);
    expect(secondPage.nextCursor).toBeNull();

    const targetPage = await listImpersonationWindowsByTarget({
      targetUserId: target.id,
      limit: 10,
    });
    expect(targetPage.rows.map(({id}) => id)).toEqual([ids[2], ids[1], ids[0]]);
  });

  test('materializes expired rows before enforcing the fixed five-window limit', async () => {
    const actor = await userFactory.create({emailVerifiedAt: new Date()});
    const target = await userFactory.create({emailVerifiedAt: new Date()});
    const now = new Date('2026-01-01T00:30:00.000Z');

    await impersonationWindowFactory.create({
      actorId: actor.id,
      targetUserId: target.id,
      startedAt: new Date('2026-01-01T00:00:00.000Z'),
      deadlineAt: new Date('2026-01-01T00:01:00.000Z'),
    });
    for (let index = 0; index < 4; index += 1) {
      const startedAt = new Date(now.getTime() + (index + 1) * 1000);
      await impersonationWindowFactory.create({
        actorId: actor.id,
        targetUserId: target.id,
        startedAt,
        deadlineAt: new Date(startedAt.getTime() + 60_000),
      });
    }

    await expect(countOpenImpersonationWindows({actorId: actor.id, now})).resolves.toBe(4);
    await expect(
      requireImpersonationWindowCapacity({actorId: actor.id, now}),
    ).resolves.toBeUndefined();

    const expired = await db()
      .select({
        endedAt: impersonationWindows.endedAt,
        endedReason: impersonationWindows.endedReason,
      })
      .from(impersonationWindows)
      .where(
        and(eq(impersonationWindows.actorId, actor.id), lte(impersonationWindows.deadlineAt, now)),
      )
      .limit(1);
    expect(expired[0]).toMatchObject({endedAt: expect.any(Date), endedReason: 'expired'});

    for (let index = 0; index < 2; index += 1) {
      const startedAt = new Date(now.getTime() + (index + 10) * 1000);
      await impersonationWindowFactory.create({
        actorId: actor.id,
        targetUserId: target.id,
        startedAt,
        deadlineAt: new Date(startedAt.getTime() + 60_000),
      });
    }

    await expect(
      requireImpersonationWindowCapacity({actorId: actor.id, now}),
    ).rejects.toBeInstanceOf(ImpersonationWindowLimitReachedError);
  });

  test('enforces terminal consistency and a deadline after the start', async () => {
    const actor = await userFactory.create({emailVerifiedAt: new Date()});
    const target = await userFactory.create({emailVerifiedAt: new Date()});
    const startedAt = new Date('2026-01-01T00:00:00.000Z');

    await expect(
      createImpersonationWindow({
        actorId: actor.id,
        targetUserId: target.id,
        reason: 'Invalid deadline',
        actorRoleAtStart: 'admin-operator',
        startedAt,
        deadlineAt: startedAt,
      }),
    ).rejects.toThrow();

    await expect(
      createImpersonationWindow({
        actorId: actor.id,
        targetUserId: target.id,
        reason: 'Invalid terminal state',
        actorRoleAtStart: 'admin-operator',
        startedAt,
        deadlineAt: new Date(startedAt.getTime() + 60_000),
        endedAt: startedAt,
      }),
    ).rejects.toThrow();
  });

  test('allows shared grant readers together and blocks an exclusive mutation', async () => {
    let releaseHolder!: () => void;
    const holderReleased = new Promise<void>((resolve) => {
      releaseHolder = resolve;
    });
    let holderReady!: () => void;
    const holderLocked = new Promise<void>((resolve) => {
      holderReady = resolve;
    });
    const holder = db().transaction(async (tx) => {
      await lockAdminOwnerGrants(tx, 'shared');
      holderReady();
      await holderReleased;
    });

    try {
      await holderLocked;

      const sharedProbe = await withPostgresSession(async (client) => {
        await client.query('BEGIN');
        try {
          const result = await client.query(
            "SELECT pg_try_advisory_xact_lock_shared(hashtext('auth_admin_owner_grants')) AS acquired",
          );
          return Boolean(result.rows[0]?.acquired);
        } finally {
          await client.query('ROLLBACK');
        }
      });
      const exclusiveProbe = await withPostgresSession(async (client) => {
        await client.query('BEGIN');
        try {
          const result = await client.query(
            "SELECT pg_try_advisory_xact_lock(hashtext('auth_admin_owner_grants')) AS acquired",
          );
          return Boolean(result.rows[0]?.acquired);
        } finally {
          await client.query('ROLLBACK');
        }
      });

      expect(sharedProbe).toBe(true);
      expect(exclusiveProbe).toBe(false);
    } finally {
      releaseHolder();
      await holder;
    }

    const unlockedExclusiveProbe = await withPostgresSession(async (client) => {
      await client.query('BEGIN');
      try {
        const result = await client.query(
          "SELECT pg_try_advisory_xact_lock(hashtext('auth_admin_owner_grants')) AS acquired",
        );
        return Boolean(result.rows[0]?.acquired);
      } finally {
        await client.query('ROLLBACK');
      }
    });
    expect(unlockedExclusiveProbe).toBe(true);
  });

  test('serializes one actor while allowing another actor to proceed', async () => {
    const actorId = '00000000-0000-0000-0000-000000000001';
    let releaseHolder!: () => void;
    const holderReleased = new Promise<void>((resolve) => {
      releaseHolder = resolve;
    });
    let holderReady!: () => void;
    const holderLocked = new Promise<void>((resolve) => {
      holderReady = resolve;
    });
    const holder = db().transaction(async (tx) => {
      await lockImpersonationWindowActor(tx, actorId);
      holderReady();
      await holderReleased;
    });

    const probe = async (probeActorId: string): Promise<boolean> =>
      await withPostgresSession(async (client) => {
        await client.query('BEGIN');
        try {
          const result = await client.query(
            'SELECT pg_try_advisory_xact_lock(hashtext($1)) AS acquired',
            [`auth_impersonation_window:${probeActorId}`],
          );
          return Boolean(result.rows[0]?.acquired);
        } finally {
          await client.query('ROLLBACK');
        }
      });

    try {
      await holderLocked;
      await expect(probe(actorId)).resolves.toBe(false);
      await expect(probe('00000000-0000-0000-0000-000000000002')).resolves.toBe(true);
    } finally {
      releaseHolder();
      await holder;
    }
  });
});
