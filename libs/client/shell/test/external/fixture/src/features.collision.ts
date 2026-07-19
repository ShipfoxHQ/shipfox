import {defaultFeatures} from '@shipfox/client-features';
import {defineClientFeature} from '@shipfox/client-shell';

const collisionFeature = defineClientFeature({
  id: 'fixture.unapproved-collision',
  routes: [
    {
      path: '/auth/login',
      parent: 'root',
      impl: './features/login-override',
    },
  ],
});

export const features = [...defaultFeatures(), collisionFeature];
