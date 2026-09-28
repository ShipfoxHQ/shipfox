import {index, text, timestamp} from 'drizzle-orm/pg-core';
import {pgTable} from './common.js';

/** Consumed OIDC token ids. The primary key makes a token work once across replicas. */
export const usedTokens = pgTable(
  'used_tokens',
  {
    jti: text('jti').primaryKey(),
    consumedAt: timestamp('consumed_at', {withTimezone: true}).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', {withTimezone: true}).notNull(),
  },
  (table) => [index('registry_used_tokens_expires_at_idx').on(table.expiresAt)],
);
