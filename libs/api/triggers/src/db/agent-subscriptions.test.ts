import {eq} from 'drizzle-orm';
import {listAgentSubscriptionsByProject, projectAgentSubscriptions} from './agent-subscriptions.js';
import {db} from './db.js';
import {agentSubscriptions} from './schema/agent-subscriptions.js';

describe('projectAgentSubscriptions', () => {
  let workspaceId: string;
  let projectId: string;

  beforeEach(() => {
    workspaceId = crypto.randomUUID();
    projectId = crypto.randomUUID();
  });

  function project(agents: Parameters<typeof projectAgentSubscriptions>[0]['agents']) {
    return projectAgentSubscriptions({workspaceId, projectId, agents});
  }

  test('stores each rule with its project, agent, source, and filter', async () => {
    await project([
      {
        key: 'payments',
        rules: [
          {source: 'slack', filter: 'request.channel_id == "C04PAYMENTS"'},
          {source: 'linear'},
        ],
      },
    ]);

    const rows = await listAgentSubscriptionsByProject(projectId);
    expect(
      rows.map(({workspaceId: ws, agentKey, source, filter}) => ({ws, agentKey, source, filter})),
    ).toEqual(
      expect.arrayContaining([
        {
          ws: workspaceId,
          agentKey: 'payments',
          source: 'slack',
          filter: 'request.channel_id == "C04PAYMENTS"',
        },
        {ws: workspaceId, agentKey: 'payments', source: 'linear', filter: null},
      ]),
    );
    expect(rows).toHaveLength(2);
  });

  test('keeps the creation date of a rule that stays', async () => {
    await project([{key: 'payments', rules: [{source: 'slack'}]}]);
    const [first] = await listAgentSubscriptionsByProject(projectId);
    await db()
      .update(agentSubscriptions)
      .set({createdAt: new Date('2026-01-01T00:00:00Z')})
      .where(eq(agentSubscriptions.projectId, projectId));

    await project([{key: 'payments', rules: [{source: 'slack'}, {source: 'linear'}]}]);

    const rows = await listAgentSubscriptionsByProject(projectId);
    const slack = rows.find((row) => row.source === 'slack');
    expect(slack?.id).toBe(first?.id);
    expect(slack?.createdAt).toEqual(new Date('2026-01-01T00:00:00Z'));
    expect(rows).toHaveLength(2);
  });

  test('removes the subscription of a rule that is gone', async () => {
    await project([{key: 'payments', rules: [{source: 'slack'}, {source: 'linear'}]}]);

    await project([{key: 'payments', rules: [{source: 'linear'}]}]);

    const rows = await listAgentSubscriptionsByProject(projectId);
    expect(rows.map((row) => row.source)).toEqual(['linear']);
  });

  test('removes the subscriptions of an agent that is gone', async () => {
    await project([
      {key: 'payments', rules: [{source: 'slack'}]},
      {key: 'support', rules: [{source: 'slack'}]},
    ]);

    await project([{key: 'support', rules: [{source: 'slack'}]}]);

    const rows = await listAgentSubscriptionsByProject(projectId);
    expect(rows.map((row) => row.agentKey)).toEqual(['support']);
  });

  test('removes every subscription when no agent has a rule', async () => {
    await project([{key: 'payments', rules: [{source: 'slack'}]}]);

    await project([]);

    expect(await listAgentSubscriptionsByProject(projectId)).toEqual([]);
  });

  test('treats a changed filter as a new binding', async () => {
    await project([
      {key: 'payments', rules: [{source: 'slack', filter: 'request.channel_id == "A"'}]},
    ]);
    const [before] = await listAgentSubscriptionsByProject(projectId);

    await project([
      {key: 'payments', rules: [{source: 'slack', filter: 'request.channel_id == "B"'}]},
    ]);

    const rows = await listAgentSubscriptionsByProject(projectId);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).not.toBe(before?.id);
    expect(rows[0]?.filter).toBe('request.channel_id == "B"');
  });

  test('stores a repeated rule once', async () => {
    await project([{key: 'payments', rules: [{source: 'slack'}, {source: 'slack'}]}]);

    expect(await listAgentSubscriptionsByProject(projectId)).toHaveLength(1);
  });

  test('keeps the subscriptions of other projects', async () => {
    const otherProjectId = crypto.randomUUID();
    await projectAgentSubscriptions({
      workspaceId,
      projectId: otherProjectId,
      agents: [{key: 'payments', rules: [{source: 'slack'}]}],
    });

    await project([]);

    expect(await listAgentSubscriptionsByProject(otherProjectId)).toHaveLength(1);
  });
});
