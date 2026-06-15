// config.ts requires SHIPFOX_API_URL and SHIPFOX_RUNNER_TOKEN with no defaults. Set via
// setupFiles so they land before any test imports config.
process.env.SHIPFOX_API_URL = 'https://api.test';
process.env.SHIPFOX_RUNNER_TOKEN = 'test-runner-token';
