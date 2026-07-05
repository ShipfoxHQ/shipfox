import {logger} from '@shipfox/node-opentelemetry';
import {triggerSourceConfigSchemas} from '@shipfox/workflow-document';
import {eq, sql} from 'drizzle-orm';
import {config} from '#config.js';
import {computeNextFireAt} from '#core/compute-next-fire-at.js';
import type {CronSchedule} from '#core/entities/cron-schedule.js';
import {db, type Tx} from './db.js';
import {toCronSchedule, triggersCronSchedules} from './schema/cron-schedules.js';

const defaultCronTimezone = 'UTC';

export interface SyncCronScheduleParams {
  readonly tx: Tx;
  readonly subscriptionId: string;
  readonly workspaceId: string;
  readonly triggerConfig: Record<string, unknown> | undefined;
}

export async function syncCronSchedule(params: SyncCronScheduleParams): Promise<void> {
  const parsed = triggerSourceConfigSchemas.cron.safeParse(params.triggerConfig ?? {});
  if (!parsed.success || parsed.data.schedule === undefined) {
    logger().warn(
      {subscriptionId: params.subscriptionId},
      'cron trigger missing/invalid schedule config; skipping cron row',
    );
    return;
  }

  const schedule = parsed.data.schedule;
  const timezone = parsed.data.timezone ?? defaultCronTimezone;
  let nextFireAt: Date;
  try {
    nextFireAt = computeNextFireAt({
      cronExpression: schedule,
      timezone,
      from: new Date(),
      subscriptionId: params.subscriptionId,
      jitterWindowSeconds: config.TRIGGER_CRON_JITTER_WINDOW_SECONDS,
    });
  } catch (error) {
    logger().warn(
      {err: error, reason: errorMessage(error), subscriptionId: params.subscriptionId},
      'cron trigger schedule could not be parsed; skipping cron row',
    );
    return;
  }

  await params.tx
    .insert(triggersCronSchedules)
    .values({
      subscriptionId: params.subscriptionId,
      workspaceId: params.workspaceId,
      cronExpression: schedule,
      timezone,
      nextFireAt,
    })
    .onConflictDoUpdate({
      target: triggersCronSchedules.subscriptionId,
      set: {
        workspaceId: sql`excluded.workspace_id`,
        cronExpression: sql`excluded.cron_expression`,
        timezone: sql`excluded.timezone`,
        updatedAt: sql`case when ${triggersCronSchedules.workspaceId} <> excluded.workspace_id or ${triggersCronSchedules.cronExpression} <> excluded.cron_expression or ${triggersCronSchedules.timezone} <> excluded.timezone then ${new Date()} else ${triggersCronSchedules.updatedAt} end`,
        nextFireAt: sql`case when ${triggersCronSchedules.cronExpression} <> excluded.cron_expression or ${triggersCronSchedules.timezone} <> excluded.timezone then excluded.next_fire_at else ${triggersCronSchedules.nextFireAt} end`,
      },
    });
}

export interface DeleteCronScheduleForSubscriptionParams {
  readonly tx: Tx;
  readonly subscriptionId: string;
}

export async function deleteCronScheduleForSubscription(
  params: DeleteCronScheduleForSubscriptionParams,
): Promise<void> {
  await params.tx
    .delete(triggersCronSchedules)
    .where(eq(triggersCronSchedules.subscriptionId, params.subscriptionId));
}

export async function getCronScheduleBySubscriptionId(
  subscriptionId: string,
): Promise<CronSchedule | undefined> {
  const rows = await db()
    .select()
    .from(triggersCronSchedules)
    .where(eq(triggersCronSchedules.subscriptionId, subscriptionId))
    .limit(1);
  const row = rows[0];
  if (!row) return undefined;
  return toCronSchedule(row);
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  try {
    return String(error);
  } catch {
    return '[unprintable thrown value]';
  }
}
