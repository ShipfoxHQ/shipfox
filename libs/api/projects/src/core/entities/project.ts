export interface Project {
  id: string;
  workspaceId: string;
  sourceConnectionId: string;
  sourceExternalRepositoryId: string;
  sourceRepositoryOwner: string | null;
  sourceRepositoryName: string | null;
  sourceDefaultBranch: string | null;
  name: string;
  slug: string;
  /** The workspace's one project that answers requests no other agent claims. */
  isDefault: boolean;
  createdAt: Date;
  updatedAt: Date;
}
