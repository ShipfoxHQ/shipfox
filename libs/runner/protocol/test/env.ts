// config.ts requires runner connection env with no defaults. Set via setupFiles
// so they land before any test imports config.
process.env.SHIPFOX_API_URL = 'https://api.test';
process.env.SHIPFOX_RUNNER_REGISTRATION_TOKEN = 'sf_mrt_test-runner-registration-token';
process.env.SHIPFOX_RUNNER_LABELS = 'Linux,x64,linux';
