import {defineClientFeature} from '@shipfox/client-shell';

export const invitationsFeature = defineClientFeature({
  id: 'shipfox.invitations',
  routes: [
    {
      path: '/invitations/accept',
      parent: 'root',
      impl: '@shipfox/client-invitations/routes/accept',
    },
  ],
});
