import {defineClientFeature, type NavTabEntry} from '@shipfox/client-shell';

export const projectsNavigation = [
  {
    id: 'nav.projects',
    scope: 'workspace',
    label: 'Projects',
    to: '/w/$workspaceSlug',
    exact: true,
    order: 100,
  },
] as const satisfies readonly NavTabEntry[];

export const projectSettingsSections = [
  {
    id: 'settings.project-general',
    scope: 'project',
    pathSegment: 'general',
    label: 'General',
    icon: 'settings3Line',
    order: 50,
  },
  {
    id: 'settings.project-access',
    scope: 'project',
    pathSegment: 'access',
    label: 'Access',
    icon: 'shieldKeyholeLine',
    order: 60,
  },
] as const;

export const projectsFeature = defineClientFeature({
  id: 'shipfox.projects',
  routes: [
    {
      path: '/w/$workspaceSlug',
      parent: 'workspaceLayout',
      impl: '@shipfox/client-projects/routes/home',
    },
    {
      path: '/w/$workspaceSlug/projects/new',
      parent: 'workspaceLayout',
      impl: '@shipfox/client-projects/routes/create-project',
    },
    {
      path: '/w/$workspaceSlug/p/$projectSlug',
      parent: 'projectLayout',
      impl: '@shipfox/client-projects/routes/project-index',
    },
    {
      path: '/w/$workspaceSlug/p/$projectSlug/settings',
      parent: 'projectSettings',
      impl: '@shipfox/client-projects/routes/project-settings-index',
    },
    {
      path: '/w/$workspaceSlug/p/$projectSlug/settings/general',
      parent: 'projectSettings',
      impl: '@shipfox/client-projects/routes/project-settings',
    },
    {
      path: '/w/$workspaceSlug/p/$projectSlug/settings/access',
      parent: 'projectSettings',
      impl: '@shipfox/client-projects/routes/project-access-settings',
    },
  ],
  navigation: projectsNavigation,
  settingsSections: projectSettingsSections,
});
