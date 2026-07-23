import {defineClientFeature, type NavTabEntry} from '@shipfox/client-shell';

export const projectsNavigation = [
  {
    id: 'nav.projects',
    scope: 'workspace',
    label: 'Projects',
    to: '/workspaces/$wid',
    exact: true,
    order: 100,
  },
] as const satisfies readonly NavTabEntry[];

export const projectsFeature = defineClientFeature({
  id: 'shipfox.projects',
  routes: [
    {
      path: '/workspaces/$wid',
      parent: 'workspaceLayout',
      impl: '@shipfox/client-projects/routes/home',
    },
    {
      path: '/workspaces/$wid/projects/new',
      parent: 'workspaceLayout',
      impl: '@shipfox/client-projects/routes/create-project',
    },
    {
      path: '/workspaces/$wid/projects/$pid',
      parent: 'projectLayout',
      impl: '@shipfox/client-projects/routes/project-index',
    },
  ],
  navigation: projectsNavigation,
});
