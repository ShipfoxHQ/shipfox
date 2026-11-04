import type {DefinitionResolvedEvent} from '@shipfox/api-definitions-dto';
import type {ProjectDeletedEvent} from '@shipfox/api-projects-dto';
import type {WorkflowsJobActivatedEventDto} from '@shipfox/api-workflows-dto';
import {ScopeDeletedError} from '@shipfox/node-drizzle';
import {eq} from 'drizzle-orm';
import {projectAgentSubscriptions} from '#db/agent-subscriptions.js';
import {db} from '#db/db.js';
import {upsertAgentDecision} from '#db/event-history.js';
import {agentSubscriptions} from '#db/schema/agent-subscriptions.js';
import {triggersCronSchedules} from '#db/schema/cron-schedules.js';
import {triggersDecisions} from '#db/schema/decisions.js';
import {triggersDeletedScopes} from '#db/schema/deleted-scopes.js';
import {jobListenerSubscriptions} from '#db/schema/job-listener-subscriptions.js';
import {triggerSubscriptions} from '#db/schema/subscriptions.js';
import {
  cronScheduleFactory,
  decisionFactory,
  jobListenerSubscriptionFactory,
  receivedEventFactory,
  triggerSubscriptionFactory,
} from '#test/index.js';
import {onDefinitionAgentRulesResolved} from './on-definition-agent-rules-resolved.js';
import {onDefinitionResolved} from './on-definition-resolved.js';
import {onJobActivated} from './on-job-activated.js';
import {onProjectDeleted} from './on-project-deleted.js';

function buildDeleted(overrides: Partial<ProjectDeletedEvent> = {}): ProjectDeletedEvent {
  return {
    workspaceId: crypto.randomUUID(),
    projectId: crypto.randomUUID(),
    deletedBy: crypto.randomUUID(),
    deletedAt: new Date().toISOString(),
    ...overrides,
  };
}

async function seedProject(params: {workspaceId: string; projectId: string}) {
  const subscription = await triggerSubscriptionFactory.create({
    workspaceId: params.workspaceId,
    projectId: params.projectId,
    source: 'cron',
    event: null,
  });
  await cronScheduleFactory.create({
    subscriptionId: subscription.id,
    workspaceId: params.workspaceId,
  });
  await jobListenerSubscriptionFactory.create({
    workspaceId: params.workspaceId,
    projectId: params.projectId,
  });
  await projectAgentSubscriptions({
    workspaceId: params.workspaceId,
    projectId: params.projectId,
    agents: [{key: 'triage', rules: [{source: 'slack'}]}],
  });
  const receivedEvent = await receivedEventFactory.create({workspaceId: params.workspaceId});
  await decisionFactory.create({
    receivedEventId: receivedEvent.id,
    subscriptionId: subscription.id,
    projectId: params.projectId,
  });
  return {subscription};
}

async function countRows(projectId: string) {
  const [subscriptions, listeners, agents, decisions] = await Promise.all([
    db().select().from(triggerSubscriptions).where(eq(triggerSubscriptions.projectId, projectId)),
    db()
      .select()
      .from(jobListenerSubscriptions)
      .where(eq(jobListenerSubscriptions.projectId, projectId)),
    db().select().from(agentSubscriptions).where(eq(agentSubscriptions.projectId, projectId)),
    db().select().from(triggersDecisions).where(eq(triggersDecisions.projectId, projectId)),
  ]);
  return {
    subscriptions: subscriptions.length,
    listeners: listeners.length,
    agents: agents.length,
    decisions: decisions.length,
  };
}

describe('onProjectDeleted', () => {
  it('deletes the subscriptions, cron schedules, listeners, agent rules, and decisions of the project', async () => {
    const event = buildDeleted();
    const {subscription} = await seedProject(event);

    await onProjectDeleted(event);

    expect(await countRows(event.projectId)).toEqual({
      subscriptions: 0,
      listeners: 0,
      agents: 0,
      decisions: 0,
    });
    const schedules = await db()
      .select()
      .from(triggersCronSchedules)
      .where(eq(triggersCronSchedules.subscriptionId, subscription.id));
    expect(schedules).toHaveLength(0);
  });

  it('leaves another project of the same workspace untouched', async () => {
    const event = buildDeleted();
    const other = {workspaceId: event.workspaceId, projectId: crypto.randomUUID()};
    await seedProject(event);
    await seedProject(other);

    await onProjectDeleted(event);

    expect(await countRows(other.projectId)).toEqual({
      subscriptions: 1,
      listeners: 1,
      agents: 1,
      decisions: 1,
    });
  });

  it('records the deletion marker and marks the purge done', async () => {
    const event = buildDeleted();
    await seedProject(event);

    await onProjectDeleted(event);

    const [marker] = await db()
      .select()
      .from(triggersDeletedScopes)
      .where(eq(triggersDeletedScopes.projectId, event.projectId));
    expect(marker).toMatchObject({
      workspaceId: event.workspaceId,
      reason: 'project_deleted',
    });
    expect(marker?.purgedAt).toBeInstanceOf(Date);
  });

  it('is safe to deliver twice', async () => {
    const event = buildDeleted();
    await seedProject(event);

    await onProjectDeleted(event);
    await onProjectDeleted(event);

    const markers = await db()
      .select()
      .from(triggersDeletedScopes)
      .where(eq(triggersDeletedScopes.projectId, event.projectId));
    expect(markers).toHaveLength(1);
    expect(await countRows(event.projectId)).toEqual({
      subscriptions: 0,
      listeners: 0,
      agents: 0,
      decisions: 0,
    });
  });

  it('creates nothing for a definition resolved after the deletion', async () => {
    const event = buildDeleted();
    await onProjectDeleted(event);
    const late: DefinitionResolvedEvent = {
      definitionId: crypto.randomUUID(),
      projectId: event.projectId,
      workspaceId: event.workspaceId,
      configPath: '.shipfox/workflow.yml',
      triggers: {onPush: {source: 'github', event: 'push'}},
    };

    await onDefinitionResolved(late);

    expect((await countRows(event.projectId)).subscriptions).toBe(0);
  });

  it('creates no agent rule or listener subscription after the deletion', async () => {
    const event = buildDeleted();
    await onProjectDeleted(event);

    await onDefinitionAgentRulesResolved({
      workspaceId: event.workspaceId,
      projectId: event.projectId,
      agents: [{key: 'triage', rules: [{source: 'slack'}]}],
    });
    await onJobActivated({
      jobId: crypto.randomUUID(),
      workflowRunId: crypto.randomUUID(),
      workspaceId: event.workspaceId,
      projectId: event.projectId,
      mode: 'listening',
      on: [{source: 'github', event: 'push'}],
      until: null,
    } as WorkflowsJobActivatedEventDto);

    const rows = await countRows(event.projectId);
    expect(rows.agents).toBe(0);
    expect(rows.listeners).toBe(0);
  });

  it('stores no agent routing decision for the project after the deletion', async () => {
    const event = buildDeleted();
    await onProjectDeleted(event);
    const receivedEvent = await receivedEventFactory.create({workspaceId: event.workspaceId});

    await expect(
      upsertAgentDecision({
        receivedEventId: receivedEvent.id,
        workspaceId: event.workspaceId,
        decision: 'default',
        agentKey: 'triage',
        projectId: event.projectId,
        reason: null,
      }),
    ).rejects.toBeInstanceOf(ScopeDeletedError);

    expect((await countRows(event.projectId)).decisions).toBe(0);
  });

  it('still projects definitions for another project of the same workspace', async () => {
    const event = buildDeleted();
    await onProjectDeleted(event);
    const otherProjectId = crypto.randomUUID();

    await onDefinitionResolved({
      definitionId: crypto.randomUUID(),
      projectId: otherProjectId,
      workspaceId: event.workspaceId,
      configPath: '.shipfox/workflow.yml',
      triggers: {onPush: {source: 'github', event: 'push'}},
    });

    expect((await countRows(otherProjectId)).subscriptions).toBe(1);
  });
});
