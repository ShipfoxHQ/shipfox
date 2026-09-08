import type {
  AdministratorUserSummaryInterModule,
  AuthInterModuleClient,
} from '@shipfox/api-auth-dto/inter-module';
import {pgClient} from '@shipfox/node-postgres';
import {describe, expect, it, vi} from '@shipfox/vitest/vi';
import {eq} from 'drizzle-orm';
import {db} from '#db/db.js';
import {createMembership} from '#db/memberships.js';
import {memberships} from '#db/schema/memberships.js';
import {createWorkspace} from '#db/workspaces.js';
import {listWorkspaceAdministratorMembers} from './admin-workspace-members.js';

function summaryFor(id: string, index: number): AdministratorUserSummaryInterModule {
  const timestamp = '2026-09-05T12:00:00.000Z';
  return {
    id,
    email: `member-${index}-${id}@example.com`,
    name: `Member ${index}`,
    status: 'active',
    emailVerifiedAt: timestamp,
    createdAt: timestamp,
    adminRole: null,
  };
}

describe('workspace administrator member discovery', () => {
  it('keeps membership pagination bounded and fixed-query', async () => {
    const workspace = await createWorkspace({name: `Page ${crypto.randomUUID()}`});
    const createdMemberships = await Promise.all(
      Array.from({length: 201}, (_, index) =>
        createMembership({
          userId: crypto.randomUUID(),
          userEmail: `page-${index}-${crypto.randomUUID()}@example.com`,
          workspaceId: workspace.id,
        }),
      ),
    );
    await db()
      .update(memberships)
      .set({createdAt: new Date('2026-09-05T12:00:00.000Z')})
      .where(eq(memberships.workspaceId, workspace.id));
    const auth = {
      listImpersonationEligibleUserSummaries: vi.fn(async ({userIds}: {userIds?: string[]}) => ({
        users: userIds?.map((userId: string, index: number) => summaryFor(userId, index)) ?? [],
        nextCursor: null,
      })),
    } as unknown as AuthInterModuleClient;
    const query = vi.spyOn(pgClient(), 'query');

    try {
      const firstPage = await listWorkspaceAdministratorMembers({
        workspaceId: workspace.id,
        auth,
        limit: 25,
      });

      expect(firstPage.members).toHaveLength(25);
      expect(firstPage.nextCursor).toMatchObject({mode: 'membership'});
      const firstAuthInput = vi.mocked(auth.listImpersonationEligibleUserSummaries).mock
        .calls[0]?.[0];
      expect(firstAuthInput).toMatchObject({limit: 200});
      expect(firstAuthInput?.userIds).toHaveLength(200);
      expect(
        firstAuthInput?.userIds?.every((userId: string) =>
          createdMemberships.some((membership) => membership.userId === userId),
        ),
      ).toBe(true);
      expect(query).toHaveBeenCalledTimes(2);

      query.mockClear();
      const secondPage = await listWorkspaceAdministratorMembers({
        workspaceId: workspace.id,
        auth,
        limit: 25,
        cursor: firstPage.nextCursor ?? undefined,
      });

      expect(secondPage.members).toHaveLength(1);
      expect(secondPage.nextCursor).toBeNull();
      expect(query).toHaveBeenCalledTimes(2);
    } finally {
      query.mockRestore();
    }
  });

  it('searches Auth candidates first and keeps an empty filtered page cursor', async () => {
    const workspace = await createWorkspace({name: `Search ${crypto.randomUUID()}`});
    const membership = await createMembership({
      userId: crypto.randomUUID(),
      workspaceId: workspace.id,
    });
    const candidateIds = [
      membership.userId,
      ...Array.from({length: 199}, () => crypto.randomUUID()),
    ];
    const auth = {
      listImpersonationEligibleUserSummaries: vi
        .fn()
        .mockImplementation(async ({cursor}: {cursor?: string}) => ({
          users: (cursor ? candidateIds.slice(200) : candidateIds).map((id, index) =>
            summaryFor(id, index),
          ),
          nextCursor: cursor ? null : 'auth-cursor',
        })),
    } as unknown as AuthInterModuleClient;
    const query = vi.spyOn(pgClient(), 'query');

    try {
      const firstPage = await listWorkspaceAdministratorMembers({
        workspaceId: workspace.id,
        auth,
        search: membership.userEmail,
        limit: 25,
      });

      expect(firstPage.members.map(({id}) => id)).toEqual([membership.userId]);
      expect(firstPage.nextCursor).toEqual({mode: 'search', authCursor: 'auth-cursor'});
      expect(query).toHaveBeenCalledTimes(2);

      query.mockClear();
      const secondPage = await listWorkspaceAdministratorMembers({
        workspaceId: workspace.id,
        auth,
        search: membership.userEmail,
        limit: 25,
        cursor: firstPage.nextCursor ?? undefined,
      });

      expect(secondPage.members).toEqual([]);
      expect(secondPage.nextCursor).toBeNull();
      expect(query).toHaveBeenCalledTimes(2);
    } finally {
      query.mockRestore();
    }
  });
});
