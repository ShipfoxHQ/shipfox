import {createRootRoute, createRoute, Outlet} from '@tanstack/react-router';
import {NavTabs} from '#components/nav-tabs.js';
import {SettingsNav} from '#components/settings-nav.js';
import type {NavTabEntry, SettingsSectionEntry} from '#contract.js';

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
    id: 'workspace-layout',
    component: () => (
      <>
        <NavTabs entries={navigation} scope="workspace" />
        <Outlet />
      </>
    ),
  });
  const projectLayout = createRoute({
    getParentRoute: () => workspaceLayout,
    id: 'project-layout',
    component: () => (
      <>
        <NavTabs entries={navigation} scope="project" />
        <Outlet />
      </>
    ),
  });
  const workspaceSettings = createRoute({
    getParentRoute: () => workspaceLayout,
    id: 'workspace-settings',
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
