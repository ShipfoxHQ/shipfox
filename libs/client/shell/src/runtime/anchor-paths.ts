const anchorPaths = {
  root: '/',
  workspaceLayout: '/workspaces/$wid',
  projectLayout: '/workspaces/$wid/projects/$pid',
  workspaceSettings: '/workspaces/$wid/settings',
} as const;

export {anchorPaths};

export function routePathForAnchor(anchor: keyof typeof anchorPaths, fullPath: string): string {
  const anchorPath = anchorPaths[anchor];
  if (anchor === 'root') return fullPath;
  if (fullPath === anchorPath) return '/';
  if (!fullPath.startsWith(`${anchorPath}/`)) {
    throw new Error(`Route "${fullPath}" must be nested under anchor "${anchor}" (${anchorPath}).`);
  }
  return fullPath.slice(anchorPath.length);
}
