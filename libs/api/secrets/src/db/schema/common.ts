import {sql} from 'drizzle-orm';
import {pgTableCreator} from 'drizzle-orm/pg-core';

export const pgTable = pgTableCreator((name) => `secrets_${name}`);

export function sqlStringLiteral(value: string) {
  return sql.raw(`'${value.replaceAll("'", "''")}'`);
}
