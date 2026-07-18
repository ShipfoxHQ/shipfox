import {defineClientFeature} from '@shipfox/client-shell';

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
    {
      path: '/workspaces/$wid/projects/$pid/workflows',
      parent: 'projectLayout',
      impl: '@shipfox/client-projects/routes/workflows',
    },
  ],
  navigation: [
    {
      id: 'nav.projects',
      scope: 'workspace',
      label: 'Projects',
      to: '/workspaces/$wid',
      exact: true,
      order: 100,
    },
    {
      id: 'nav.workflows',
      scope: 'project',
      label: 'Workflows',
      to: '/workspaces/$wid/projects/$pid/workflows',
      order: 200,
    },
  ],
});
