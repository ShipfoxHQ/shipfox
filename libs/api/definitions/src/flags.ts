import {defineFlags} from '@shipfox/feature-flags';

export const definitionsFlags = defineFlags({
  'definitions-actions': {
    kind: 'boolean',
    default: false,
    desc: 'Allows workflow steps to run repository and registry actions with `uses`. When off, a workflow with a `uses` step fails validation with "not supported yet".',
  },
});
