export interface ProjectsSearch {
  search?: string;
}

export function validateProjectsSearch(input: Record<string, unknown>): ProjectsSearch {
  const search = typeof input.search === 'string' ? input.search.trim() : '';
  return search ? {search} : {};
}
