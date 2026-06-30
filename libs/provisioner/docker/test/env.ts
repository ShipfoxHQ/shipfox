// The Docker provisioner reads its own templates-file path and inherits the core
// control-plane connection env. Set them via setupFiles so they land before any test
// imports config.
process.env.SHIPFOX_API_URL = 'https://api.test';
process.env.SHIPFOX_PROVISIONER_TOKEN = 'test-provisioner-token';
process.env.SHIPFOX_PROVISIONER_TEMPLATES_FILE = '/dev/null/templates.yaml';
