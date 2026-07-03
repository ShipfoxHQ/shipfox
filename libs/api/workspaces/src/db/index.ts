import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

export {closeDb, db, schema} from './db.js';
export type {
  AcceptInvitationParams,
  AcceptInvitationResult,
  CreateInvitationParams,
} from './invitations.js';
export {
  acceptInvitation,
  createInvitation,
  findInvitationByToken,
  listOpenInvitationsByWorkspace,
  revokeInvitation,
} from './invitations.js';
export type {
  CreateMembershipParams,
  MembershipWithUser,
  MembershipWithWorkspace,
  RemoveMembershipParams,
} from './memberships.js';
export {
  createMembership,
  findMembership,
  listMembershipsByUser,
  listMembershipsByWorkspace,
  removeMembership,
} from './memberships.js';
export {workspacesOutbox} from './schema/outbox.js';
export type {
  CreateWorkspaceParams,
  UpdateWorkspaceParams,
  WorkspaceServiceMetrics,
} from './workspaces.js';
export {
  createWorkspace,
  getWorkspaceById,
  getWorkspaceServiceMetrics,
  updateWorkspace,
} from './workspaces.js';

export const migrationsPath = resolve(dirname(fileURLToPath(import.meta.url)), '../../drizzle');
