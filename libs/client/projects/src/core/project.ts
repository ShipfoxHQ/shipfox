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
  /** The workspace's one project that answers requests no other agent claims. */
  isDefault: boolean;
  source: ProjectSource;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectList {
  projects: Project[];
  nextCursor: string | null;
}

/**
 * Whether a list holds a project the user made. Every workspace has a default project from the
 * start, so the default alone says nothing about onboarding.
 */
export function hasUserProject(list: Pick<ProjectList, 'projects'>): boolean {
  return list.projects.some((project) => !project.isDefault);
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

export interface DeleteProjectCommand {
  workspaceId: string;
  projectId: string;
  /** The project's name, typed by the admin to confirm. */
  name: string;
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
