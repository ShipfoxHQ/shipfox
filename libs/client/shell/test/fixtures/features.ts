import {defineClientFeature} from '#contract.js';

export const features = [
  defineClientFeature({
    id: 'shipfox.projects',
    routes: [
      {
        path: '/workspaces/$wid/projects/$pid/overview',
        parent: 'projectLayout',
        impl: '#test/default-route-impl.js',
      },
      {
        path: '/workspaces/$wid/settings/members',
        parent: 'workspaceSettings',
        impl: '#test/default-route-impl.js',
      },
    ],
    navigation: [
      {
        id: 'projects',
        scope: 'workspace',
        label: 'Projects',
        to: '/workspaces/$wid/projects/$pid/overview',
        order: 100,
      },
    ],
    settingsSections: [
      {id: 'members', pathSegment: 'members', label: 'Members', icon: 'users', order: 100},
    ],
  }),
  defineClientFeature({
    id: 'acme.insights',
    routes: [
      {
        path: '/workspaces/$wid/insights',
        parent: 'workspaceLayout',
        impl: '#test/named-route-impl.js',
      },
      {
        path: '/workspaces/$wid/projects/$pid/overview',
        parent: 'projectLayout',
        override: true,
        impl: '#test/search-route-impl.js',
      },
    ],
    navigation: [
      {
        id: 'insights',
        scope: 'workspace',
        label: 'Insights',
        to: '/workspaces/$wid/insights',
        order: 200,
      },
    ],
  }),
] as const;
