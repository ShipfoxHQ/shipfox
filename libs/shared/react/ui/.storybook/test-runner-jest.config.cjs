const {getJestConfig} = require('@storybook/test-runner');

const baseConfig = getJestConfig();

module.exports = {
  ...baseConfig,
  transform: {
    '^.+\\.(story|stories)\\.[jt]sx?$': require.resolve('./test-runner-stories-transform.js'),
    '^.+\\.[jt]sx?$': [
      require.resolve('@swc/jest'),
      {
        swcrc: false,
        jsc: {
          parser: {syntax: 'typescript', tsx: true},
          transform: {react: {runtime: 'automatic'}},
        },
      },
    ],
  },
};
