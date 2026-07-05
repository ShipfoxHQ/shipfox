import {Factory} from 'fishery';
import type {CronSchedule} from '#core/entities/cron-schedule.js';
import {db} from '#db/db.js';
import {toCronSchedule, triggersCronSchedules} from '#db/schema/cron-schedules.js';

export const cronScheduleFactory = Factory.define<CronSchedule>(({onCreate}) => {
  onCreate(async (schedule) => {
    const [row] = await db()
      .insert(triggersCronSchedules)
      .values({
        subscriptionId: schedule.subscriptionId,
        workspaceId: schedule.workspaceId,
        cronExpression: schedule.cronExpression,
        timezone: schedule.timezone,
        nextFireAt: schedule.nextFireAt,
        lastFiredAt: schedule.lastFiredAt,
      })
      .returning();
    if (!row) throw new Error('Insert returned no rows');
    return toCronSchedule(row);
  });

  return {
    subscriptionId: crypto.randomUUID(),
    workspaceId: crypto.randomUUID(),
    cronExpression: '0 2 * * *',
    timezone: 'UTC',
    // Default well into the future so a schedule is only "due" when a test says so.
    nextFireAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    lastFiredAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
});
