/** A repository the user connected. A project created from one carries it in its source. */
export interface LinkedProjectSource {
  connectionId: string;
  externalRepositoryId: string;
}

/** `managed` is a repository Shipfox hosts for the project, behind a hidden connection. */
export type ProjectSourceKind = 'managed' | 'linked';

export interface ProjectSource extends LinkedProjectSource {
  kind: ProjectSourceKind;
}

export interface Project {
  id: string;
  workspaceId: string;
  name: string;
  slug: string;
  source: ProjectSource;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectList {
  projects: Project[];
  nextCursor: string | null;
}

export interface CreateProjectCommand {
  workspaceId: string;
  name: string;
  slug: string;
  source: LinkedProjectSource;
}

export interface UpdateProjectCommand {
  projectId: string;
  name?: string;
  slug?: string;
}

const REPOSITORY_NAME_SPLIT_RE = /[/-]/;

export function projectNameFromRepository(repositoryId: string): string {
  return repositoryId
    .trim()
    .split(REPOSITORY_NAME_SPLIT_RE)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export function selectProjectSource<T extends {externalRepositoryId: string}>(
  repositories: T[],
  selectedRepositoryId: string | undefined,
): T | undefined {
  if (selectedRepositoryId) {
    return repositories.find(
      (repository) => repository.externalRepositoryId === selectedRepositoryId,
    );
  }
  return repositories[0];
}
