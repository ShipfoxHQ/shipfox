// config.ts requires control-plane connection env with no defaults. Set via
// setupFiles so they land before any test imports config.
process.env.SHIPFOX_API_URL = 'https://api.test';
process.env.SHIPFOX_PROVISIONER_TOKEN = 'test-provisioner-token';
