import type {ActionManifest} from '@shipfox/workflow-document';

export type ActionSnapshotSource = 'vcs' | 'dev_local' | 'registry';

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

/** A parsed manifest and its snapshot digest, keyed by the `uses` value that references it. */
export interface ResolvedAction {
  readonly manifest: ActionManifest;
  readonly digest: string;
  /** Set when the action is a registry version. Repository actions leave it out. */
  readonly registry?: {readonly package: string; readonly version: string};
}

export type ResolvedActions = ReadonlyMap<string, ResolvedAction>;
