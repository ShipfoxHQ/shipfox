import {and, count, eq, gt, isNull, ne, sql} from 'drizzle-orm';
import {config} from '#config.js';
import {WorkspaceMembershipCapExceededError} from '#core/errors.js';
import type {db} from './db.js';
import {invitations} from './schema/invitations.js';
import {memberships} from './schema/memberships.js';

type WorkspaceDatabase = ReturnType<typeof db>;
export type WorkspaceTransaction = Parameters<Parameters<WorkspaceDatabase['transaction']>[0]>[0];

export async function countWorkspaceMembershipSeats(
  workspaceId: string,
  tx: WorkspaceTransaction,
  excludeInvitationId?: string,
): Promise<number> {
  const memberCount = tx
    .select({count: count().as('member_count')})
    .from(memberships)
    .where(eq(memberships.workspaceId, workspaceId))
    .as('member_count');
  const openInvitationWhere = [
    eq(invitations.workspaceId, workspaceId),
    isNull(invitations.acceptedAt),
    isNull(invitations.revokedAt),
    gt(invitations.expiresAt, sql`now()`),
    ...(excludeInvitationId ? [ne(invitations.id, excludeInvitationId)] : []),
  ];
  const invitationCount = tx
    .select({count: count().as('invitation_count')})
    .from(invitations)
    .where(and(...openInvitationWhere))
    .as('invitation_count');
  const [row] = await tx
    .select({value: sql<number>`${memberCount.count} + ${invitationCount.count}`})
    .from(memberCount)
    .crossJoin(invitationCount);

  return Number(row?.value ?? 0);
}

export async function lockWorkspaceMembership(workspaceId: string, tx: WorkspaceTransaction) {
  await tx.execute(sql`
    SELECT pg_advisory_xact_lock(hashtext('shipfox_workspaces_membership_cap'), hashtext(${workspaceId}))
  `);
}

export async function assertWorkspaceMembershipCap(params: {
  workspaceId: string;
  incomingSeats: number;
  tx: WorkspaceTransaction;
  excludeInvitationId?: string;
}): Promise<void> {
  const currentSeats = await countWorkspaceMembershipSeats(
    params.workspaceId,
    params.tx,
    params.excludeInvitationId,
  );
  if (currentSeats + params.incomingSeats > config.WORKSPACES_MAX_PER_WORKSPACE) {
    throw new WorkspaceMembershipCapExceededError(
      params.workspaceId,
      config.WORKSPACES_MAX_PER_WORKSPACE,
    );
  }
}
