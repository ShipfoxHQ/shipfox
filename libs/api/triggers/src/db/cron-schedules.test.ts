import {and, eq} from 'drizzle-orm';
import {getCronScheduleBySubscriptionId} from './cron-schedules.js';
import {db} from './db.js';
import {triggersCronSchedules} from './schema/cron-schedules.js';
import {triggerSubscriptions} from './schema/subscriptions.js';
import {deleteSubscriptionsForDefinition, projectDefinitionTriggers} from './subscriptions.js';

describe('cron schedule projection', () => {
  let workspaceId: string;
  let projectId: string;
  let workflowDefinitionId: string;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
    workspaceId = crypto.randomUUID();
    projectId = crypto.randomUUID();
    workflowDefinitionId = crypto.randomUUID();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test('creates a cron schedule row with a future next fire time', async () => {
    await projectDefinitionTriggers({
      workspaceId,
      projectId,
      workflowDefinitionId,
      triggers: {
        nightly: {
          source: 'cron',
          event: 'tick',
          config: {schedule: '0 2 * * *', timezone: 'UTC'},
        },
      },
    });
    const subscription = await getSubscriptionByName(workflowDefinitionId, 'nightly');

    const schedule = await getCronScheduleBySubscriptionId(subscription.id);

    expect(schedule).toMatchObject({
      subscriptionId: subscription.id,
      workspaceId,
      cronExpression: '0 2 * * *',
      timezone: 'UTC',
      lastFiredAt: null,
    });
    expect(schedule?.nextFireAt.getTime()).toBeGreaterThan(Date.now());
  });

  test('preserves next fire and last fired when the expression and timezone are unchanged', async () => {
    await projectDefinitionTriggers({
      workspaceId,
      projectId,
      workflowDefinitionId,
      triggers: {
        nightly: {
          source: 'cron',
          event: 'tick',
          config: {schedule: '0 2 * * *', timezone: 'UTC'},
        },
      },
    });
    const subscription = await getSubscriptionByName(workflowDefinitionId, 'nightly');
    const before = await getRequiredCronSchedule(subscription.id);
    const lastFiredAt = new Date('2026-01-01T02:00:00.000Z');
    await db()
      .update(triggersCronSchedules)
      .set({lastFiredAt})
      .where(eq(triggersCronSchedules.subscriptionId, subscription.id));
    vi.setSystemTime(new Date('2026-01-01T01:00:00.000Z'));

    await projectDefinitionTriggers({
      workspaceId,
      projectId,
      workflowDefinitionId,
      triggers: {
        nightly: {
          source: 'cron',
          event: 'tick',
          config: {schedule: '0 2 * * *', timezone: 'UTC'},
        },
      },
    });
    const after = await getRequiredCronSchedule(subscription.id);

    expect(after.nextFireAt).toEqual(before.nextFireAt);
    expect(after.lastFiredAt).toEqual(lastFiredAt);
    expect(after.updatedAt).toEqual(before.updatedAt);
  });

  test('recomputes next fire when the expression changes', async () => {
    await projectDefinitionTriggers({
      workspaceId,
      projectId,
      workflowDefinitionId,
      triggers: {
        nightly: {
          source: 'cron',
          event: 'tick',
          config: {schedule: '0 2 * * *', timezone: 'UTC'},
        },
      },
    });
    const subscription = await getSubscriptionByName(workflowDefinitionId, 'nightly');
    const before = await getRequiredCronSchedule(subscription.id);

    await projectDefinitionTriggers({
      workspaceId,
      projectId,
      workflowDefinitionId,
      triggers: {
        nightly: {
          source: 'cron',
          event: 'tick',
          config: {schedule: '0 3 * * *', timezone: 'UTC'},
        },
      },
    });
    const after = await getRequiredCronSchedule(subscription.id);

    expect(after.cronExpression).toBe('0 3 * * *');
    expect(after.nextFireAt).not.toEqual(before.nextFireAt);
    expect(after.nextFireAt).toEqual(new Date('2026-01-01T03:00:00.000Z'));
  });

  test('recomputes next fire when the timezone changes', async () => {
    await projectDefinitionTriggers({
      workspaceId,
      projectId,
      workflowDefinitionId,
      triggers: {
        nightly: {
          source: 'cron',
          event: 'tick',
          config: {schedule: '0 2 * * *', timezone: 'UTC'},
        },
      },
    });
    const subscription = await getSubscriptionByName(workflowDefinitionId, 'nightly');
    const before = await getRequiredCronSchedule(subscription.id);

    await projectDefinitionTriggers({
      workspaceId,
      projectId,
      workflowDefinitionId,
      triggers: {
        nightly: {
          source: 'cron',
          event: 'tick',
          config: {schedule: '0 2 * * *', timezone: 'America/New_York'},
        },
      },
    });
    const after = await getRequiredCronSchedule(subscription.id);

    expect(after.timezone).toBe('America/New_York');
    expect(after.nextFireAt).not.toEqual(before.nextFireAt);
    expect(after.nextFireAt).toEqual(new Date('2026-01-01T07:00:00.000Z'));
  });

  test('drops a cron schedule when the trigger source changes in place', async () => {
    await projectDefinitionTriggers({
      workspaceId,
      projectId,
      workflowDefinitionId,
      triggers: {
        nightly: {
          source: 'cron',
          event: 'tick',
          config: {schedule: '0 2 * * *', timezone: 'UTC'},
        },
      },
    });
    const subscription = await getSubscriptionByName(workflowDefinitionId, 'nightly');

    await projectDefinitionTriggers({
      workspaceId,
      projectId,
      workflowDefinitionId,
      triggers: {
        nightly: {source: 'github', event: 'push'},
      },
    });
    const schedule = await getCronScheduleBySubscriptionId(subscription.id);

    expect(schedule).toBeUndefined();
  });

  test('drops a cron schedule when the trigger is removed', async () => {
    await projectDefinitionTriggers({
      workspaceId,
      projectId,
      workflowDefinitionId,
      triggers: {
        nightly: {
          source: 'cron',
          event: 'tick',
          config: {schedule: '0 2 * * *', timezone: 'UTC'},
        },
      },
    });
    const subscription = await getSubscriptionByName(workflowDefinitionId, 'nightly');

    await projectDefinitionTriggers({
      workspaceId,
      projectId,
      workflowDefinitionId,
      triggers: {},
    });
    const schedule = await getCronScheduleBySubscriptionId(subscription.id);

    expect(schedule).toBeUndefined();
  });

  test('drops a cron schedule when definition subscriptions are deleted', async () => {
    await projectDefinitionTriggers({
      workspaceId,
      projectId,
      workflowDefinitionId,
      triggers: {
        nightly: {
          source: 'cron',
          event: 'tick',
          config: {schedule: '0 2 * * *', timezone: 'UTC'},
        },
      },
    });
    const subscription = await getSubscriptionByName(workflowDefinitionId, 'nightly');

    const deletedCount = await deleteSubscriptionsForDefinition({workflowDefinitionId});
    const schedule = await getCronScheduleBySubscriptionId(subscription.id);

    expect(deletedCount).toBe(1);
    expect(schedule).toBeUndefined();
  });

  test('skips invalid cron config without blocking sibling trigger sync', async () => {
    await projectDefinitionTriggers({
      workspaceId,
      projectId,
      workflowDefinitionId,
      triggers: {
        malformed: {source: 'cron', event: 'tick', config: {}},
        bad_expression: {
          source: 'cron',
          event: 'tick',
          config: {schedule: 'not a cron', timezone: 'UTC'},
        },
        on_push: {source: 'github', event: 'push'},
      },
    });
    const malformed = await getSubscriptionByName(workflowDefinitionId, 'malformed');
    const badExpression = await getSubscriptionByName(workflowDefinitionId, 'bad_expression');
    const onPush = await getSubscriptionByName(workflowDefinitionId, 'on_push');

    const malformedSchedule = await getCronScheduleBySubscriptionId(malformed.id);
    const badExpressionSchedule = await getCronScheduleBySubscriptionId(badExpression.id);

    expect(malformedSchedule).toBeUndefined();
    expect(badExpressionSchedule).toBeUndefined();
    expect(onPush.source).toBe('github');
  });

  test('defaults a missing timezone to UTC defensively', async () => {
    await projectDefinitionTriggers({
      workspaceId,
      projectId,
      workflowDefinitionId,
      triggers: {
        hourly: {
          source: 'cron',
          event: 'tick',
          config: {schedule: '0 * * * *'},
        },
      },
    });
    const subscription = await getSubscriptionByName(workflowDefinitionId, 'hourly');

    const schedule = await getRequiredCronSchedule(subscription.id);

    expect(schedule.timezone).toBe('UTC');
  });

  test('stores only with and filter in the subscription config', async () => {
    await projectDefinitionTriggers({
      workspaceId,
      projectId,
      workflowDefinitionId,
      triggers: {
        nightly: {
          source: 'cron',
          event: 'tick',
          with: {branch: 'main'},
          filter: 'true',
          config: {schedule: '0 2 * * *', timezone: 'UTC'},
        },
      },
    });

    const subscription = await getSubscriptionByName(workflowDefinitionId, 'nightly');

    expect(subscription.config).toEqual({with: {branch: 'main'}, filter: 'true'});
  });
});

async function getSubscriptionByName(workflowDefinitionId: string, name: string) {
  const [row] = await db()
    .select()
    .from(triggerSubscriptions)
    .where(
      and(
        eq(triggerSubscriptions.workflowDefinitionId, workflowDefinitionId),
        eq(triggerSubscriptions.name, name),
      ),
    )
    .limit(1);
  if (!row) throw new Error(`Expected subscription ${name} to exist`);
  return row;
}

async function getRequiredCronSchedule(subscriptionId: string) {
  const schedule = await getCronScheduleBySubscriptionId(subscriptionId);
  if (!schedule) throw new Error(`Expected cron schedule for subscription ${subscriptionId}`);
  return schedule;
}
