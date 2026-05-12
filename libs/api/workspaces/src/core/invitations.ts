import type {UserContextMembership} from '@shipfox/api-auth-context';
import {generateOpaqueToken, hashOpaqueToken} from '@shipfox/node-tokens';
import {config, mailer} from '#config.js';
import {
  type AcceptInvitationResult,
  acceptInvitation,
  createInvitation,
  findInvitationById,
  findInvitationByToken,
  listOpenInvitationsByWorkspace,
  revokeInvitation,
} from '#db/invitations.js';
import {getWorkspaceById} from '#db/workspaces.js';
import type {Invitation} from './entities/invitation.js';
import {
  InvitationEmailMismatchError,
  InvitationNotFoundError,
  InvitationWorkspaceMismatchError,
  TokenAlreadyUsedError,
  TokenExpiredError,
  TokenInvalidError,
} from './errors.js';
import {requireWorkspaceMembership} from './workspaces.js';

const INVITATION_TTL_DAYS = 7;

function daysFromNow(days: number): Date {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

export async function createWorkspaceInvitation(params: {
  workspaceId: string;
  email: string;
  invitedByUserId: string;
  invitedByDisplay?: string | null;
  invitedByMemberships: ReadonlyArray<UserContextMembership>;
}): Promise<Invitation> {
  await requireWorkspaceMembership({
    workspaceId: params.workspaceId,
    userId: params.invitedByUserId,
    memberships: params.invitedByMemberships,
  });

  const rawToken = generateOpaqueToken('invitation');
  const invitation = await createInvitation({
    workspaceId: params.workspaceId,
    email: params.email,
    hashedToken: hashOpaqueToken(rawToken),
    expiresAt: daysFromNow(INVITATION_TTL_DAYS),
    invitedByUserId: params.invitedByUserId,
    invitedByDisplay: params.invitedByDisplay ?? null,
  });

  const link = `${config.CLIENT_BASE_URL}/invitations/accept?token=${rawToken}`;
  await mailer.send({
    to: params.email,
    subject: 'You have been invited to a workspace',
    text: `Click to accept: ${link}`,
    html: `<p>Click to accept: <a href="${link}">${link}</a></p>`,
  });

  return invitation;
}

export async function peekInvitationByRawToken(params: {
  token: string;
}): Promise<Invitation | undefined> {
  return await findInvitationByToken({hashedToken: hashOpaqueToken(params.token)});
}

export type PreviewInvitationResult =
  | {
      status: 'pending';
      workspaceId: string;
      workspaceName: string;
      email: string;
      invitedByDisplay: string | null;
      expiresAt: Date;
    }
  | {status: 'expired'; workspaceName: string; expiresAt: Date}
  | {status: 'already_used'; workspaceName: string}
  | {status: 'invalid'};

export async function previewInvitation(params: {token: string}): Promise<PreviewInvitationResult> {
  const invitation = await peekInvitationByRawToken({token: params.token});
  if (!invitation) {
    return {status: 'invalid'};
  }

  const workspace = await getWorkspaceById(invitation.workspaceId);
  if (!workspace) {
    // Workspace cascade-deleted — the invitation row is orphaned. Treat as invalid.
    return {status: 'invalid'};
  }

  if (invitation.acceptedAt !== null) {
    return {status: 'already_used', workspaceName: workspace.name};
  }

  if (invitation.expiresAt.getTime() <= Date.now()) {
    return {
      status: 'expired',
      workspaceName: workspace.name,
      expiresAt: invitation.expiresAt,
    };
  }

  return {
    status: 'pending',
    workspaceId: workspace.id,
    workspaceName: workspace.name,
    email: invitation.email,
    invitedByDisplay: invitation.invitedByDisplay,
    expiresAt: invitation.expiresAt,
  };
}

export async function acceptWorkspaceInvitation(params: {
  token: string;
  userId: string;
  email: string;
  name?: string | null | undefined;
}): Promise<AcceptInvitationResult> {
  const invitation = await peekInvitationByRawToken({token: params.token});
  if (!invitation) {
    throw new TokenInvalidError('Invitation token is invalid');
  }

  if (invitation.acceptedAt !== null) {
    throw new TokenAlreadyUsedError();
  }

  if (invitation.expiresAt.getTime() <= Date.now()) {
    throw new TokenExpiredError();
  }

  if (params.email !== invitation.email) {
    throw new InvitationEmailMismatchError();
  }

  const result = await acceptInvitation({
    invitationId: invitation.id,
    acceptedByUserId: params.userId,
    acceptedByUserName: params.name,
  });
  if (!result) {
    throw new TokenInvalidError('Invitation is no longer valid');
  }

  return result;
}

export async function listWorkspaceInvitations(params: {
  workspaceId: string;
  requesterUserId: string;
  requesterMemberships: ReadonlyArray<UserContextMembership>;
}): Promise<Invitation[]> {
  await requireWorkspaceMembership({
    workspaceId: params.workspaceId,
    userId: params.requesterUserId,
    memberships: params.requesterMemberships,
  });

  return listOpenInvitationsByWorkspace({workspaceId: params.workspaceId});
}

export async function revokeWorkspaceInvitation(params: {
  workspaceId: string;
  requesterUserId: string;
  requesterMemberships: ReadonlyArray<UserContextMembership>;
  invitationId: string;
}): Promise<void> {
  await requireWorkspaceMembership({
    workspaceId: params.workspaceId,
    userId: params.requesterUserId,
    memberships: params.requesterMemberships,
  });

  const invitation = await findInvitationById({id: params.invitationId});
  if (!invitation) {
    throw new InvitationNotFoundError(params.invitationId);
  }

  if (invitation.workspaceId !== params.workspaceId) {
    throw new InvitationWorkspaceMismatchError();
  }

  await revokeInvitation({invitationId: params.invitationId});
}
