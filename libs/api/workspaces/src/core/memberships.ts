import {
  type EnsureMembershipParams,
  ensureMembership as ensureDbMembership,
} from '#db/memberships.js';
import type {Membership} from './entities/membership.js';
import {getWorkspace} from './workspaces.js';

export type {EnsureMembershipParams} from '#db/memberships.js';

/**
 * Ensures an external identity has a workspace membership without refreshing
 * the profile snapshot stored on an existing membership.
 */
export async function ensureMembership(params: EnsureMembershipParams): Promise<Membership> {
  await getWorkspace({workspaceId: params.workspaceId});
  return await ensureDbMembership(params);
}
