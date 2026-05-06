import type {WorkspaceRole} from '@shipfox/api-workspaces-dto';

export interface Membership {
  id: string;
  userId: string;
  userEmail: string;
  userName: string | null;
  workspaceId: string;
  role: WorkspaceRole;
  createdAt: Date;
  updatedAt: Date;
}
