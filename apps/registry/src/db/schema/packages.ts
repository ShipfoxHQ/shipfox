import {sql} from 'drizzle-orm';
import {check, index, jsonb, text, timestamp} from 'drizzle-orm/pg-core';
import {pgTable} from './common.js';

/** One row per package, with the card fields of its latest version. */
export const packages = pgTable(
  'packages',
  {
    name: text('name').primaryKey(),
    namespace: text('namespace').notNull(),
    kind: text('kind').notNull(),
    visibility: text('visibility').notNull().default('public'),
    firstPublishedAt: timestamp('first_published_at', {withTimezone: true}).notNull(),
    title: text('title').notNull(),
    summary: text('summary').notNull(),
    keywords: jsonb('keywords').$type<string[]>().notNull().default([]),
    integrations: jsonb('integrations').$type<string[]>().notNull().default([]),
    latestVersion: text('latest_version').notNull(),
    latestPublishedAt: timestamp('latest_published_at', {withTimezone: true}).notNull(),
  },
  (table) => [
    check('registry_packages_kind_check', sql`${table.kind} in ('action', 'template')`),
    index('registry_packages_namespace_idx').on(table.namespace),
    index('registry_packages_kind_idx').on(table.kind),
  ],
);
