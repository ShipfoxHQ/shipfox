import {timestamp, uuid} from 'drizzle-orm/pg-core';
import {pgTable} from './common.js';

export const expiredJobExecutions = pgTable('expired_job_executions', {
  jobExecutionId: uuid('job_execution_id').primaryKey(),
  expiredAt: timestamp('expired_at', {withTimezone: true}).notNull().defaultNow(),
});

export type ExpiredJobExecutionDb = typeof expiredJobExecutions.$inferSelect;
export type ExpiredJobExecutionInsertDb = typeof expiredJobExecutions.$inferInsert;
