import {defineConfig} from 'drizzle-kit';

export default defineConfig({
  schema: [
    './src/db/schema/decisions.ts',
    './src/db/schema/outbox.ts',
    './src/db/schema/received-events.ts',
    './src/db/schema/subscriptions.ts',
  ],
  out: './drizzle',
  dialect: 'postgresql',
});
