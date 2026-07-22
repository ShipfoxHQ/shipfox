export interface UserIdentity {
  id: string;
  email: string;
  name?: string;
  emailVerifiedAt?: string;
}

export interface AuthenticatedSession {
  accessToken: string;
  user: UserIdentity;
}

export interface WorkspaceMembership {
  id: string;
  workspaceId: string;
}

export interface WorkspaceSummary {
  id: string;
  name: string;
  membershipId: string;
}
