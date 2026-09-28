import {index, timestamp, uuid} from 'drizzle-orm/pg-core';
import {pgTable} from './common.js';

export const expiredJobExecutions = pgTable(
  'expired_job_executions',
  {
    jobExecutionId: uuid('job_execution_id').primaryKey(),
    expiredAt: timestamp('expired_at', {withTimezone: true}).notNull().defaultNow(),
  },
  (table) => [index('runners_expired_job_executions_expired_at_idx').on(table.expiredAt)],
);

export type ExpiredJobExecutionDb = typeof expiredJobExecutions.$inferSelect;
export type ExpiredJobExecutionInsertDb = typeof expiredJobExecutions.$inferInsert;
