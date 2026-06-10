import {pgTableCreator} from 'drizzle-orm/pg-core';

export const pgTable = pgTableCreator((name) => `integrations_sentry_${name}`);
