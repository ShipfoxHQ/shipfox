import type {Buffer} from 'node:buffer';
import type {
  RegistryEnvelope,
  RegistryPackageKind,
  RegistryVersionDocument,
} from '@shipfox/registry-format';
import {customType, jsonb, primaryKey, text, timestamp} from 'drizzle-orm/pg-core';
import type {RegistryVersion} from '#core/registry-version.js';
import {pgTable} from './common.js';

// drizzle-orm has no native bytea column; node-postgres reads and writes bytea as Buffer.
const bytea = customType<{data: Buffer; driverData: Buffer}>({
  dataType() {
    return 'bytea';
  },
});

export const registryVersions = pgTable(
  'versions',
  {
    registry: text('registry').notNull(),
    package: text('package').notNull(),
    version: text('version').notNull(),
    kind: text('kind').notNull().$type<RegistryPackageKind>(),
    digest: text('digest').notNull(),
    envelope: jsonb('envelope').notNull().$type<RegistryEnvelope>(),
    document: jsonb('document').notNull().$type<RegistryVersionDocument>(),
    content: bytea('content').notNull(),
    source: bytea('source'),
    readme: text('readme'),
    fetchedAt: timestamp('fetched_at', {withTimezone: true}).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({
      name: 'registry_versions_pkey',
      columns: [table.registry, table.package, table.version],
    }),
  ],
);

export type RegistryVersionDb = typeof registryVersions.$inferSelect;
export type RegistryVersionCreateDb = typeof registryVersions.$inferInsert;

export function toRegistryVersion(row: RegistryVersionDb): RegistryVersion {
  return {
    ...row,
    content: new Uint8Array(row.content),
    source: row.source === null ? null : new Uint8Array(row.source),
  };
}
