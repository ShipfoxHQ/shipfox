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
