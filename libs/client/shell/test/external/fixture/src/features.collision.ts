import {defineClientFeature} from '@shipfox/client-shell';
import {toyFeature} from '@shipfox/client-shell-fixture-feature';

const collisionFeature = defineClientFeature({
  id: 'fixture.unapproved-collision',
  routes: [
    {
      path: '/workspaces/$wid/insights',
      parent: 'workspaceLayout',
      impl: './features/override-impl',
    },
  ],
});

export const features = [toyFeature, collisionFeature];
