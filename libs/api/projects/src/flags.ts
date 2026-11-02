import {defineFlags} from '@shipfox/feature-flags';

export const projectsFlags = defineFlags({
  'managed-config-repos': {
    kind: 'boolean',
    default: false,
    desc: 'Allows creating a project with no repository. Shipfox hosts its `.shipfox/` tree in a managed repository. When off, `POST /projects` refuses a managed source.',
  },
});
