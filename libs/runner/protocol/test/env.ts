// config.ts requires SHIPFOX_API_URL with no default; the rest of the SHIPFOX_* config has
// safe defaults. Set via setupFiles so it lands before any test imports config.
process.env.SHIPFOX_API_URL = 'https://api.test';
