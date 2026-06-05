/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'dto-only-dto-as-dependencies',
      comment:
        '@shipfox/*-dto packages may only have other *-dto packages as production dependencies. All other @shipfox packages must be devDependencies.',
      severity: 'error',
      from: {path: '^(src|test)/'},
      to: {
        // pnpm workspace deps resolve as relative paths (../sibling/).
        // Match any workspace sibling that is not a *-dto package.
        path: '^\\.\\./[^./][^/]*/(?:src|dist)/',
        pathNot: '^\\.\\./(?:[^/]+-dto|workflow-language)/',
      },
    },
    {
      name: 'workflow-language-no-feature-runtime-dependencies',
      comment:
        '@shipfox/api-workflow-language is a lower-level language package and must not import feature, runtime, adapter, or app packages.',
      severity: 'error',
      from: {
        path: '^(src|test|scripts)/',
      },
      to: {
        path: '^\\.\\./(?:definitions|workflows|triggers|runners)(?:-dto)?/(?:src|dist)/|^(?:\\.\\./)+client/|^(?:\\.\\./)+apps/|^(?:\\.\\./)+shared/node/(?:drizzle|fastify|temporal)/(?:src|dist)/|^node_modules/(?:drizzle-orm|fastify|@temporalio/)',
      },
    },
  ],
  options: {
    doNotFollow: {
      path: 'node_modules',
    },
    tsPreCompilationDeps: true,
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default', 'development'],
      mainFields: ['module', 'main', 'types'],
    },
  },
};
