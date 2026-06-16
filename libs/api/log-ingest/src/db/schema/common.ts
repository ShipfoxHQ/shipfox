import type {Buffer} from 'node:buffer';
import {customType, pgTableCreator} from 'drizzle-orm/pg-core';

export const pgTable = pgTableCreator((name) => `log_ingest_${name}`);

// drizzle-orm 0.45 has no native bytea column; the node-postgres driver returns
// and accepts Buffer for bytea, so a customType is the supported path.
export const bytea = customType<{data: Buffer; driverData: Buffer}>({
  dataType() {
    return 'bytea';
  },
});
