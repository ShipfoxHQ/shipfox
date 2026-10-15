import type {ActionManifest} from '@shipfox/workflow-document';
import type {WorkflowSourceLocation} from './workflow-model.js';

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

/**
 * A parsed manifest and its snapshot digest, keyed by the `uses` value that
 * references it. A `uses` inside a composite action is keyed by its
 * repository path (`./dir/sub` for `${{ action.path }}/sub`).
 */
export interface ResolvedAction {
  readonly manifest: ActionManifest;
  readonly digest: string;
  /** Set when the action is a registry version. Repository actions leave it out. */
  readonly registry?: {readonly package: string; readonly version: string};
  /** Set on a composite action. */
  readonly composite?: ResolvedCompositeAction;
}

/** What expanding a composite action's steps needs besides its manifest. */
export interface ResolvedCompositeAction {
  /** Repository path of the manifest, or `uses/action.yml` for a registry action. */
  readonly manifestPath: string;
  /** The manifest file name in the action directory, `action.yml` or `action.yaml`. */
  readonly manifestFile: string;
  /** Line ranges of the manifest's steps, by index. */
  readonly stepLocations: ReadonlyMap<number, WorkflowSourceLocation>;
  /** The action's files by path relative to its directory, for `${{ action.path }}/` prompt files. */
  readonly files: ReadonlyMap<string, string>;
}

export type ResolvedActions = ReadonlyMap<string, ResolvedAction>;
