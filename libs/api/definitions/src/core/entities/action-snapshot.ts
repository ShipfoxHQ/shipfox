export type ActionSnapshotSource = 'vcs' | 'dev_local';

export interface ActionSnapshot {
  workspaceId: string;
  digest: string;
  /** The project where the snapshot was first stored, kept for diagnostics. */
  projectId: string;
  manifest: Record<string, unknown>;
  /** The gzipped canonical bundle from `encodeActionBundle`. */
  bundle: Uint8Array;
  fileCount: number;
  bytes: number;
  source: ActionSnapshotSource;
  createdAt: Date;
}
