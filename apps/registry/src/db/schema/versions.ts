import {sql} from 'drizzle-orm';
import {boolean, check, jsonb, primaryKey, text, timestamp} from 'drizzle-orm/pg-core';
import {pgTable} from './common.js';
import {packages} from './packages.js';

/** One row per published version. Rows are inserted once and never updated. */
export const versions = pgTable(
  'versions',
  {
    package: text('package')
      .notNull()
      .references(() => packages.name),
    version: text('version').notNull(),
    envelope: jsonb('envelope').notNull(),
    document: jsonb('document').notNull(),
    fingerprint: text('fingerprint').notNull(),
    contentDigest: text('content_digest').notNull(),
    sourceDigest: text('source_digest').notNull(),
    readme: text('readme'),
    bump: text('bump'),
    capabilityChange: boolean('capability_change').notNull().default(false),
    publishedAt: timestamp('published_at', {withTimezone: true}).notNull(),
  },
  (table) => [
    primaryKey({name: 'registry_versions_pkey', columns: [table.package, table.version]}),
    check(
      'registry_versions_bump_check',
      sql`${table.bump} is null or ${table.bump} in ('major', 'minor', 'patch')`,
    ),
  ],
);
