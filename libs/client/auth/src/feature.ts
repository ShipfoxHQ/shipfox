import {defineClientFeature} from '@shipfox/client-shell';

export const authFeature = defineClientFeature({
  id: 'shipfox.auth',
  routes: [
    {path: '/', parent: 'root', impl: '@shipfox/client-auth/routes/index'},
    {path: '/auth/login', parent: 'root', impl: '@shipfox/client-auth/routes/login'},
    {path: '/auth/logout', parent: 'root', impl: '@shipfox/client-auth/routes/logout'},
    {path: '/auth/reset', parent: 'root', impl: '@shipfox/client-auth/routes/reset'},
    {path: '/auth/signup', parent: 'root', impl: '@shipfox/client-auth/routes/signup'},
    {
      path: '/setup/workspaces/new',
      parent: 'root',
      impl: '@shipfox/client-auth/routes/workspace-onboarding',
    },
  ],
});
