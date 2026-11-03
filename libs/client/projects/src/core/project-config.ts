export type ConfigSourceKind = 'managed' | 'linked';

/** Where a project's config lives, read from the project row so it answers during an outage. */
export interface ProjectConfigSource {
  kind: ConfigSourceKind;
  provider: string;
  connectionId: string;
  externalRepositoryId: string;
  owner: string | null;
  name: string | null;
  defaultBranch: string;
}

export interface ProjectConfig {
  source: ProjectConfigSource;
  /** Null while the provider can't answer. */
  head: {ref: string; commit: string} | null;
  historySupported: boolean;
  /** Null unless the project moved, or is moving, from a managed repository. */
  move: ProjectConfigMove | null;
  /** Null once the pull request merged, or when the move opened none. */
  pullRequest: ProjectConfigPullRequest | null;
}

/** `linking` while a move runs or stopped with an unknown outcome, `linked` once it finished. */
export type ConfigMoveStatus = 'linking' | 'linked';

export interface ProjectConfigMove {
  status: ConfigMoveStatus;
  target: {
    connectionId: string;
    externalRepositoryId: string;
    /** Null when the provider can't answer, or once the move is no longer running. */
    fullName: string | null;
  };
  /** The user id of the member who started the move. */
  startedBy: string | null;
  startedAt: string | null;
}

/** `unknown` while the provider can't answer. */
export type ConfigPullRequestState = 'open' | 'merged' | 'closed' | 'unknown';

export interface ProjectConfigPullRequest {
  url: string;
  number: number;
  state: ConfigPullRequestState;
}

export type RepositoryVisibility = 'public' | 'private' | 'internal' | 'unknown';

export interface MoveProjectConfigCommand {
  projectId: string;
  connectionId: string;
  externalRepositoryId: string;
}

/** A repository that passed the move checks, and how many files the pull request adds. */
export interface ConfigMoveCheck {
  repository: {
    externalRepositoryId: string;
    fullName: string;
    defaultBranch: string;
    visibility: RepositoryVisibility;
  };
  fileCount: number;
}

export interface ConfigMoveResult extends ConfigMoveCheck {
  /** Null when the config had no files to add. */
  pullRequest: ProjectConfigPullRequest | null;
}

export type ConfigFileType = 'file' | 'symlink' | 'submodule';

export interface ConfigFileEntry {
  path: string;
  type: ConfigFileType;
  /** Null when the provider doesn't report sizes. */
  size: number | null;
}

/** Every file under `.shipfox/` at one commit. */
export interface ConfigFileList {
  commit: string;
  files: ConfigFileEntry[];
}

export interface ConfigFile {
  path: string;
  commit: string;
  content: string;
}

export interface ConfigCommit {
  oid: string;
  message: string;
  authorName: string;
  authoredAt: string;
  /** Set by providers with their own commit page. */
  htmlUrl: string | null;
}

export interface ConfigCommitPage {
  commits: ConfigCommit[];
  nextCursor: string | null;
}
