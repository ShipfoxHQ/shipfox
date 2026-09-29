import {jsonb, primaryKey, text, timestamp} from 'drizzle-orm/pg-core';
import {pgTable} from './common.js';

export const registryIndexes = pgTable(
  'indexes',
  {
    registry: text('registry').notNull(),
    /** `catalog`, or a package name such as `shipfox/ticket-to-pr`. */
    key: text('key').notNull(),
    body: jsonb('body').notNull().$type<unknown>(),
    /** The `ETag` the registry answered with, sent back as `If-None-Match`. */
    etag: text('etag'),
    fetchedAt: timestamp('fetched_at', {withTimezone: true}).notNull(),
  },
  (table) => [primaryKey({name: 'registry_indexes_pkey', columns: [table.registry, table.key]})],
);

export type RegistryIndexDb = typeof registryIndexes.$inferSelect;
