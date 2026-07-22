export interface InvitationAcceptance {
  membership: {
    id: string;
    userId: string;
    workspaceId: string;
  };
  alreadyMember: boolean;
}
