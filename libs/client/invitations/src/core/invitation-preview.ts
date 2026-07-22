export type InvitationPreview =
  | {
      status: 'pending';
      workspaceId: string;
      workspaceName: string;
      email: string;
      invitedByDisplay?: string;
      expiresAt: string;
    }
  | {status: 'expired'; workspaceName: string; expiresAt: string}
  | {status: 'already_used'; workspaceName: string}
  | {status: 'invalid'};

export function pendingInvitation(
  preview: InvitationPreview | undefined,
): Extract<InvitationPreview, {status: 'pending'}> | undefined {
  return preview?.status === 'pending' ? preview : undefined;
}
