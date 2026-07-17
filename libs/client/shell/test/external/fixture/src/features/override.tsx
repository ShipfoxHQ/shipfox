import {defineClientFeature} from '@shipfox/client-shell';
import {recordProvider} from '@shipfox/client-shell-fixture-feature';
import {useQueryClient} from '@tanstack/react-query';
import type {PropsWithChildren} from 'react';

function AppFeatureProvider({children}: PropsWithChildren) {
  recordProvider('app-feature', useQueryClient());
  return children;
}

export const overrideFeature = defineClientFeature({
  id: 'fixture.app-override',
  routes: [
    {
      path: '/workspaces/$wid/insights',
      parent: 'workspaceLayout',
      override: true,
      impl: './features/override-impl',
    },
  ],
  providers: [{id: 'fixture-app-provider', Component: AppFeatureProvider}],
});
