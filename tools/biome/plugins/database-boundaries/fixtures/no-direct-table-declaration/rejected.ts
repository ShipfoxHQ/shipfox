// The owner schema factory must be used here.

import {pgTable, pgTableCreator} from 'drizzle-orm/pg-core';

export const rejectedTable = pgTable('rejected_table');
export const rejectedFactory = pgTableCreator((name) => `owner_${name}`);
