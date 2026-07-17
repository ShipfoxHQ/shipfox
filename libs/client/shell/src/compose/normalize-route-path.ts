const trailingSlashes = /\/+$/u;

export function normalizeRoutePath(path: string): string {
  if (path === '/') return path;
  return path.replace(trailingSlashes, '') || '/';
}
