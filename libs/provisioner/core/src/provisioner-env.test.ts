import {buildRunnerEnv} from '#provisioner.js';

describe('buildRunnerEnv', () => {
  it('includes the runner maximum lifetime in the shared image contract', () => {
    const runnerEnv = buildRunnerEnv({
      template: {key: 'small', labels: ['ubuntu24'], maxConcurrency: 1, cost: 1, spec: null},
      bootstrapToken: 'sf_rbt_test',
    });

    expect(runnerEnv).toMatchObject({
      SHIPFOX_RUNNER_MAX_LIFETIME_SECONDS: '3600',
      SHIPFOX_POLL_MAX_DURATION_MS: '300000',
    });
  });
});
