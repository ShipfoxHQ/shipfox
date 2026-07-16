import {createRootRoute, createRoute, Outlet} from '@tanstack/react-router';
import {NavTabs} from '#components/nav-tabs.js';
import {SettingsNav} from '#components/settings-nav.js';
import type {NavTabEntry, SettingsSectionEntry} from '#contract.js';

const anchorPaths = {
  root: '/',
  workspaceLayout: '/workspaces/$wid',
  projectLayout: '/workspaces/$wid/projects/$pid',
  workspaceSettings: '/workspaces/$wid/settings',
} as const;

export function routePathForAnchor(anchor: keyof typeof anchorPaths, fullPath: string): string {
  const anchorPath = anchorPaths[anchor];
  if (anchor === 'root') return fullPath;
  if (!fullPath.startsWith(`${anchorPath}/`)) {
    throw new Error(`Route "${fullPath}" must be nested under anchor "${anchor}" (${anchorPath}).`);
  }
  return fullPath.slice(anchorPath.length);
}

export function buildAnchorSkeleton({
  navigation,
  settingsSections,
}: {
  navigation: readonly NavTabEntry[];
  settingsSections: readonly SettingsSectionEntry[];
}) {
  const rootRoute = createRootRoute({component: Outlet});
  const workspaceLayout = createRoute({
    getParentRoute: () => rootRoute,
    path: anchorPaths.workspaceLayout,
    component: () => (
      <>
        <NavTabs entries={navigation} scope="workspace" />
        <Outlet />
      </>
    ),
  });
  const projectLayout = createRoute({
    getParentRoute: () => workspaceLayout,
    path: '/projects/$pid',
    component: () => (
      <>
        <NavTabs entries={navigation} scope="project" />
        <Outlet />
      </>
    ),
  });
  const workspaceSettings = createRoute({
    getParentRoute: () => workspaceLayout,
    path: '/settings',
    component: () => (
      <>
        <SettingsNav entries={settingsSections} />
        <Outlet />
      </>
    ),
  });
  return {
    anchors: {root: rootRoute, workspaceLayout, projectLayout, workspaceSettings},
    rootRoute,
    workspaceLayout,
    projectLayout,
    workspaceSettings,
  };
}
