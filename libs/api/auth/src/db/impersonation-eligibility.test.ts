import {
  IMPERSONATION_ELIGIBILITY_MAX_PAGE_SIZE,
  IMPERSONATION_ELIGIBILITY_MAX_USER_IDS,
} from '@shipfox/api-auth-dto/inter-module';
import {pgClient} from '@shipfox/node-postgres';
import {describe, expect, it, vi} from '@shipfox/vitest/vi';
import {eq} from 'drizzle-orm';
import {userFactory} from '#test/index.js';
import {createAdminGrant, revokeAdminGrant} from './admin-grants.js';
import {listImpersonationEligibleUserSummaries} from './admin-user-summary.js';
import {db} from './db.js';
import {users} from './schema/users.js';

async function setCreatedAt(userId: string, createdAt: Date): Promise<void> {
  await db().update(users).set({createdAt}).where(eq(users.id, userId));
}

describe('impersonation eligibility user summaries', () => {
  it('filters one bounded ID batch and preserves the input order', async () => {
    const marker = `impersonation-ids-${crypto.randomUUID()}`;
    const eligibleFirst = await userFactory.create({
      email: `${marker}-first@example.com`,
      emailVerifiedAt: new Date(),
    });
    const eligibleSecond = await userFactory.create({
      email: `${marker}-second@example.com`,
      emailVerifiedAt: new Date(),
    });
    const unverified = await userFactory.create({email: `${marker}-unverified@example.com`});
    const suspended = await userFactory.create({
      email: `${marker}-suspended@example.com`,
      emailVerifiedAt: new Date(),
    });
    const administrator = await userFactory.create({
      email: `${marker}-administrator@example.com`,
      emailVerifiedAt: new Date(),
    });
    const revokedAdministrator = await userFactory.create({
      email: `${marker}-revoked@example.com`,
      emailVerifiedAt: new Date(),
    });
    await db().update(users).set({status: 'suspended'}).where(eq(users.id, suspended.id));
    await createAdminGrant({userId: administrator.id, role: 'admin-operator'});
    const revokedGrant = await createAdminGrant({
      userId: revokedAdministrator.id,
      role: 'admin-observer',
    });
    await revokeAdminGrant({grantId: revokedGrant.id});

    const result = await listImpersonationEligibleUserSummaries(db(), {
      userIds: [
        unverified.id,
        eligibleSecond.id,
        administrator.id,
        eligibleFirst.id,
        suspended.id,
        revokedAdministrator.id,
      ],
      limit: IMPERSONATION_ELIGIBILITY_MAX_PAGE_SIZE,
    });

    expect(result.rows.map(({id}) => id)).toEqual([
      eligibleSecond.id,
      eligibleFirst.id,
      revokedAdministrator.id,
    ]);
    expect(result.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({id: eligibleSecond.id, adminRole: null}),
        expect.objectContaining({id: eligibleFirst.id, adminRole: null}),
        expect.objectContaining({id: revokedAdministrator.id, adminRole: null}),
      ]),
    );
    expect(result.nextCursor).toBeNull();
  });

  it('uses one database query for a bounded ID batch and applies the page limit', async () => {
    const usersToFind = await Promise.all(
      Array.from({length: 3}, (_, index) =>
        userFactory.create({
          email: `impersonation-query-${crypto.randomUUID()}-${index}@example.com`,
          emailVerifiedAt: new Date(),
        }),
      ),
    );
    const query = vi.spyOn(pgClient(), 'query');

    try {
      const result = await listImpersonationEligibleUserSummaries(db(), {
        userIds: usersToFind.map(({id}) => id),
        limit: 2,
      });

      expect(result.rows).toHaveLength(2);
      expect(query).toHaveBeenCalledTimes(1);
    } finally {
      query.mockRestore();
    }
  });

  it('bounds IDs at 200 and returns no rows for an empty ID batch', async () => {
    const ids = Array.from({length: IMPERSONATION_ELIGIBILITY_MAX_USER_IDS + 1}, () =>
      crypto.randomUUID(),
    );

    await expect(
      listImpersonationEligibleUserSummaries(db(), {
        userIds: ids,
        limit: 25,
      }),
    ).rejects.toThrow('at most 200 user IDs');
    await expect(
      listImpersonationEligibleUserSummaries(db(), {
        userIds: [],
        limit: 25,
      }),
    ).resolves.toEqual({rows: [], nextCursor: null});
  });

  it('searches eligible identities in deterministic keyset pages', async () => {
    const marker = `impersonation-search-${crypto.randomUUID()}`;
    const older = await userFactory.create({
      email: `${marker}-older@example.com`,
      emailVerifiedAt: new Date(),
    });
    const newerFirst = await userFactory.create({
      email: `${marker}-newer-first@example.com`,
      emailVerifiedAt: new Date(),
    });
    const newerSecond = await userFactory.create({
      email: `${marker}-newer-second@example.com`,
      emailVerifiedAt: new Date(),
    });
    const unverified = await userFactory.create({email: `${marker}-unverified@example.com`});
    const timestamp = new Date('2099-01-01T00:00:00.000Z');
    await setCreatedAt(older.id, new Date(timestamp.getTime() - 1_000));
    await setCreatedAt(newerFirst.id, timestamp);
    await setCreatedAt(newerSecond.id, timestamp);
    await setCreatedAt(unverified.id, timestamp);

    const sameTimestampOrder = [newerFirst, newerSecond].sort((left, right) =>
      right.id.localeCompare(left.id),
    );
    const firstPage = await listImpersonationEligibleUserSummaries(db(), {
      search: marker,
      limit: 2,
    });

    expect(firstPage.rows.map(({id}) => id)).toEqual([
      sameTimestampOrder[0]?.id,
      sameTimestampOrder[1]?.id,
    ]);
    expect(firstPage.nextCursor).toEqual({
      createdAt: timestamp,
      id: sameTimestampOrder[1]?.id,
    });

    const secondPage = await listImpersonationEligibleUserSummaries(db(), {
      search: marker,
      limit: 2,
      cursor: firstPage.nextCursor ?? undefined,
    });

    expect(secondPage.rows.map(({id}) => id)).toEqual([older.id]);
    expect(secondPage.nextCursor).toBeNull();
    expect(secondPage.rows.map(({id}) => id)).not.toContain(unverified.id);
  });

  it('returns at most 200 search candidates and advances with a cursor', async () => {
    const marker = `impersonation-search-bound-${crypto.randomUUID()}`;
    await db()
      .insert(users)
      .values(
        Array.from({length: IMPERSONATION_ELIGIBILITY_MAX_PAGE_SIZE + 1}, (_, index) => ({
          email: `${marker}-${index}@example.com`,
          name: `Search Candidate ${index}`,
          hashedPassword: null,
          emailVerifiedAt: new Date(),
        })),
      );

    const firstPage = await listImpersonationEligibleUserSummaries(db(), {
      search: marker,
      limit: IMPERSONATION_ELIGIBILITY_MAX_PAGE_SIZE,
    });
    const secondPage = await listImpersonationEligibleUserSummaries(db(), {
      search: marker,
      limit: IMPERSONATION_ELIGIBILITY_MAX_PAGE_SIZE,
      cursor: firstPage.nextCursor ?? undefined,
    });

    expect(firstPage.rows).toHaveLength(IMPERSONATION_ELIGIBILITY_MAX_PAGE_SIZE);
    expect(firstPage.nextCursor).not.toBeNull();
    expect(secondPage.rows).toHaveLength(1);
    expect(secondPage.nextCursor).toBeNull();
  });
});
