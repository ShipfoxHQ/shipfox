import {defineConfig, type UserConfigExport} from '@shipfox/vitest';

// Case fixture repositories carry their own tests, which the runner runs inside a case.
export default defineConfig({test: {exclude: ['cases/**']}}, import.meta.url) as UserConfigExport;
