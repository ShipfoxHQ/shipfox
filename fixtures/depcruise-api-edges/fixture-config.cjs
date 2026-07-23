const {apiArchitectureEdgePolicy, createApiArchitectureRules} = require('../../api-contexts.cjs');

const architecturePackages = {
  implementations: {
    agent: ['packages/consumers/implementation-foreign'],
    integrations: [
      'packages/api/integration/core',
      'packages/api/integration/provider-with-an-unrelated-name',
      'packages/consumers/implementation-allowed',
    ],
  },
  dto: {agent: ['packages/consumers/dto-foreign']},
  'shared-semantic': {common: ['packages/consumers/semantic-foreign']},
  'shared-infrastructure': {common: []},
  spi: {
    integrations: ['packages/api/integration/spi', 'packages/consumers/spi-allowed'],
    auth: ['packages/consumers/spi-foreign'],
  },
  'composition-root': {api: []},
};

function createFixtureConfiguration(currentDirectory) {
  return {
    forbidden: createApiArchitectureRules({
      currentDirectory,
      workspaceRoot: __dirname,
      packages: architecturePackages,
      edgePolicy: apiArchitectureEdgePolicy,
    }),
    options: {
      doNotFollow: {path: 'node_modules'},
      tsPreCompilationDeps: 'specify',
    },
  };
}

module.exports = {createFixtureConfiguration};
