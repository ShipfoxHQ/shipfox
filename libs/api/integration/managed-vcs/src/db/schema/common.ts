import type {Buffer} from 'node:buffer';
import {customType, pgTableCreator} from 'drizzle-orm/pg-core';

export const pgTable = pgTableCreator((name) => `integrations_managed_vcs_${name}`);

// drizzle-orm has no native bytea column; node-postgres reads and writes bytea as Buffer.
export const bytea = customType<{data: Buffer; driverData: Buffer}>({
  dataType() {
    return 'bytea';
  },
});
