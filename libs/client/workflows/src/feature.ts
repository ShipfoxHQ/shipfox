import {defineClientFeature, type NavTabEntry} from '@shipfox/client-shell';

export const workflowsNavigation = [
  {
    id: 'nav.runs',
    scope: 'project',
    label: 'Runs',
    to: '/workspaces/$wid/projects/$pid/runs',
    order: 100,
  },
  {
    id: 'nav.workflows',
    scope: 'project',
    label: 'Workflows',
    to: '/workspaces/$wid/projects/$pid/workflows',
    order: 200,
  },
] as const satisfies readonly NavTabEntry[];

export const workflowsFeature = defineClientFeature({
  id: 'shipfox.workflows',
  routes: [
    {
      path: '/workspaces/$wid/projects/$pid/workflows',
      parent: 'projectLayout',
      impl: '@shipfox/client-workflows/routes/workflows',
    },
    {
      path: '/workspaces/$wid/projects/$pid/runs',
      parent: 'projectLayout',
      impl: '@shipfox/client-workflows/routes/runs',
    },
    {
      path: '/workspaces/$wid/projects/$pid/runs/$workflowRunId',
      parent: 'projectLayout',
      impl: '@shipfox/client-workflows/routes/run-detail',
    },
  ],
  navigation: workflowsNavigation,
});
