import {defineConfig, type UserConfigExport} from '@shipfox/vitest';

export default defineConfig({test: {}}, import.meta.url) as UserConfigExport;
