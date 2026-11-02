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
