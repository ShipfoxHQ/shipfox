import {eq} from 'drizzle-orm';
import {db} from './db.js';
import {triggerSubscriptions} from './schema/subscriptions.js';
import {
  deleteSubscriptionsForDefinition,
  findMatchingSubscriptions,
  getManualSubscriptionByDefinitionId,
  getTriggerSubscriptionById,
  projectDefinitionTriggers,
} from './subscriptions.js';

describe('projectDefinitionTriggers', () => {
  let workspaceId: string;
  let projectId: string;
  let workflowDefinitionId: string;

  beforeEach(() => {
    workspaceId = crypto.randomUUID();
    projectId = crypto.randomUUID();
    workflowDefinitionId = crypto.randomUUID();
  });

  test('inserts a row for each declared trigger', async () => {
    await projectDefinitionTriggers({
      workspaceId,
      projectId,
      workflowDefinitionId,
      triggers: {
        on_demand: {source: 'manual', event: 'fire'},
        on_push: {
          source: 'github',
          event: 'push',
          with: {branch: 'main'},
          filter: 'event.ref == "refs/heads/main"',
        },
      },
    });

    const rows = await db()
      .select()
      .from(triggerSubscriptions)
      .where(eq(triggerSubscriptions.workflowDefinitionId, workflowDefinitionId));

    expect(rows).toHaveLength(2);
    const manual = rows.find((r) => r.name === 'on_demand');
    expect(manual?.source).toBe('manual');
    expect(manual?.event).toBe('fire');
    expect(manual?.config).toEqual({});
    const push = rows.find((r) => r.name === 'on_push');
    expect(push?.source).toBe('github');
    expect(push?.event).toBe('push');
    expect(push?.config).toEqual({
      with: {branch: 'main'},
      filter: 'event.ref == "refs/heads/main"',
    });
  });

  test('removes rows whose trigger name is no longer in the map', async () => {
    await projectDefinitionTriggers({
      workspaceId,
      projectId,
      workflowDefinitionId,
      triggers: {
        on_demand: {source: 'manual', event: 'fire'},
        on_push: {source: 'github', event: 'push'},
      },
    });

    await projectDefinitionTriggers({
      workspaceId,
      projectId,
      workflowDefinitionId,
      triggers: {
        on_demand: {source: 'manual', event: 'fire'},
      },
    });

    const rows = await db()
      .select()
      .from(triggerSubscriptions)
      .where(eq(triggerSubscriptions.workflowDefinitionId, workflowDefinitionId));

    expect(rows.map((r) => r.name)).toEqual(['on_demand']);
  });

  test('updates rows in place when a trigger name persists across reconciliations', async () => {
    await projectDefinitionTriggers({
      workspaceId,
      projectId,
      workflowDefinitionId,
      triggers: {
        on_push: {source: 'github', event: 'push', with: {branch: 'main'}},
      },
    });
    const before = await db()
      .select()
      .from(triggerSubscriptions)
      .where(eq(triggerSubscriptions.workflowDefinitionId, workflowDefinitionId));
    const originalId = before[0]?.id;

    await projectDefinitionTriggers({
      workspaceId,
      projectId,
      workflowDefinitionId,
      triggers: {
        on_push: {source: 'github', event: 'push', with: {branch: 'develop'}},
      },
    });

    const after = await db()
      .select()
      .from(triggerSubscriptions)
      .where(eq(triggerSubscriptions.workflowDefinitionId, workflowDefinitionId));
    expect(after).toHaveLength(1);
    expect(after[0]?.id).toBe(originalId);
    expect(after[0]?.config).toEqual({with: {branch: 'develop'}});
  });

  test('empty triggers map removes all rows for the definition', async () => {
    await projectDefinitionTriggers({
      workspaceId,
      projectId,
      workflowDefinitionId,
      triggers: {
        on_demand: {source: 'manual', event: 'fire'},
      },
    });

    await projectDefinitionTriggers({
      workspaceId,
      projectId,
      workflowDefinitionId,
      triggers: {},
    });

    const rows = await db()
      .select()
      .from(triggerSubscriptions)
      .where(eq(triggerSubscriptions.workflowDefinitionId, workflowDefinitionId));
    expect(rows).toHaveLength(0);
  });
});

describe('deleteSubscriptionsForDefinition', () => {
  test('deletes every row for the definition', async () => {
    const workflowDefinitionId = crypto.randomUUID();
    await projectDefinitionTriggers({
      workspaceId: crypto.randomUUID(),
      projectId: crypto.randomUUID(),
      workflowDefinitionId,
      triggers: {
        a: {source: 'manual', event: 'fire'},
        b: {source: 'github', event: 'push'},
      },
    });

    const deletedCount = await deleteSubscriptionsForDefinition({workflowDefinitionId});

    expect(deletedCount).toBe(2);
    const remaining = await db()
      .select()
      .from(triggerSubscriptions)
      .where(eq(triggerSubscriptions.workflowDefinitionId, workflowDefinitionId));
    expect(remaining).toHaveLength(0);
  });
});

describe('findMatchingSubscriptions', () => {
  let workspaceId: string;
  let projectId: string;

  beforeEach(() => {
    workspaceId = crypto.randomUUID();
    projectId = crypto.randomUUID();
  });

  test('returns subscriptions matching workspace, source, event', async () => {
    const workflowDefinitionId = crypto.randomUUID();
    await projectDefinitionTriggers({
      workspaceId,
      projectId,
      workflowDefinitionId,
      triggers: {
        on_push: {source: 'github', event: 'push'},
        on_demand: {source: 'manual', event: 'fire'},
      },
    });

    const matches = await findMatchingSubscriptions({
      workspaceId,
      source: 'github',
      event: 'push',
    });

    expect(matches).toHaveLength(1);
    expect(matches[0]?.name).toBe('on_push');
  });

  test('matches across projects within the workspace, without project scoping', async () => {
    await projectDefinitionTriggers({
      workspaceId,
      projectId,
      workflowDefinitionId: crypto.randomUUID(),
      triggers: {on_push: {source: 'github', event: 'push'}},
    });
    await projectDefinitionTriggers({
      workspaceId,
      projectId: crypto.randomUUID(),
      workflowDefinitionId: crypto.randomUUID(),
      triggers: {on_push: {source: 'github', event: 'push'}},
    });

    const matches = await findMatchingSubscriptions({
      workspaceId,
      source: 'github',
      event: 'push',
    });

    expect(matches).toHaveLength(2);
  });

  test('does not return rows from other workspaces', async () => {
    await projectDefinitionTriggers({
      workspaceId,
      projectId,
      workflowDefinitionId: crypto.randomUUID(),
      triggers: {on_push: {source: 'github', event: 'push'}},
    });

    const otherWorkspace = await findMatchingSubscriptions({
      workspaceId: crypto.randomUUID(),
      source: 'github',
      event: 'push',
    });

    expect(otherWorkspace).toHaveLength(0);
  });
});

describe('getTriggerSubscriptionById', () => {
  test('returns the row when found', async () => {
    const workspaceId = crypto.randomUUID();
    const projectId = crypto.randomUUID();
    const workflowDefinitionId = crypto.randomUUID();
    await projectDefinitionTriggers({
      workspaceId,
      projectId,
      workflowDefinitionId,
      triggers: {on_demand: {source: 'manual', event: 'fire'}},
    });
    const [row] = await db()
      .select()
      .from(triggerSubscriptions)
      .where(eq(triggerSubscriptions.workflowDefinitionId, workflowDefinitionId));

    const found = await getTriggerSubscriptionById(row?.id ?? '');

    expect(found?.id).toBe(row?.id);
    expect(found?.source).toBe('manual');
    expect(found?.event).toBe('fire');
  });

  test('returns undefined when not found', async () => {
    const found = await getTriggerSubscriptionById(crypto.randomUUID());

    expect(found).toBeUndefined();
  });
});

describe('getManualSubscriptionByDefinitionId', () => {
  test('returns the manual subscription declared by a definition', async () => {
    const workflowDefinitionId = crypto.randomUUID();
    await projectDefinitionTriggers({
      workspaceId: crypto.randomUUID(),
      projectId: crypto.randomUUID(),
      workflowDefinitionId,
      triggers: {
        on_demand: {source: 'manual', event: 'fire'},
        on_push: {source: 'github', event: 'push'},
      },
    });

    const found = await getManualSubscriptionByDefinitionId(workflowDefinitionId);

    expect(found?.source).toBe('manual');
    expect(found?.name).toBe('on_demand');
  });

  test('returns undefined when the definition has no manual trigger', async () => {
    const workflowDefinitionId = crypto.randomUUID();
    await projectDefinitionTriggers({
      workspaceId: crypto.randomUUID(),
      projectId: crypto.randomUUID(),
      workflowDefinitionId,
      triggers: {on_push: {source: 'github', event: 'push'}},
    });

    const found = await getManualSubscriptionByDefinitionId(workflowDefinitionId);

    expect(found).toBeUndefined();
  });

  test('returns undefined when no rows exist for the definition', async () => {
    const found = await getManualSubscriptionByDefinitionId(crypto.randomUUID());

    expect(found).toBeUndefined();
  });
});
