import {index, integer, text, timestamp} from 'drizzle-orm/pg-core';
import {pgTable} from './common.js';

export const sendLimits = pgTable(
  'send_limits',
  {
    scope: text('scope').notNull(),
    identifierHmac: text('identifier_hmac').notNull(),
    windowStart: timestamp('window_start', {withTimezone: true}).notNull(),
    count: integer('count').notNull().default(0),
    expiresAt: timestamp('expires_at', {withTimezone: true}).notNull(),
  },
  (table) => [
    index('email_challenges_send_limits_lookup_idx').on(
      table.scope,
      table.identifierHmac,
      table.expiresAt,
    ),
    index('email_challenges_send_limits_expiry_idx').on(table.expiresAt),
  ],
);
