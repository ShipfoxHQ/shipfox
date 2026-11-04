import type {ProjectAccessPolicy} from '@shipfox/api-projects-dto';
import {eq} from 'drizzle-orm';
import {db} from '#db/db.js';
import {triggersDecisions} from '#db/schema/decisions.js';
import {triggersReceivedEvents} from '#db/schema/received-events.js';
import {jobListenerSubscriptionFactory, triggerSubscriptionFactory} from '#test/index.js';
import {dispatchIntegrationEvent} from './dispatch-integration-event.js';
import type {TriggerEventResource} from './entities/received-event.js';

const startRunFromTrigger = vi.fn();
const deliverEventToJobListener = vi.fn();

const workflows = {
  startRunFromTrigger: (...args: unknown[]) => startRunFromTrigger(...args),
  deliverEventToJobListener: (...args: unknown[]) => deliverEventToJobListener(...args),
  resolveWorkflowRunTriggerReference: () => Promise.resolve(null),
} as never;

const connectionId = crypto.randomUUID();
const appRepository: TriggerEventResource = {
  kind: 'repository',
  externalId: 'github:1',
  lookupName: 'acme/app',
};
const otherRepository: TriggerEventResource = {
  kind: 'repository',
  externalId: 'github:2',
  lookupName: 'acme/other',
};

function policy(
  projectId: string,
  connections: ProjectAccessPolicy['connections'] = 'all',
): ProjectAccessPolicy {
  return {
    projectId,
    configSource: {
      managed: true,
      connectionId: crypto.randomUUID(),
      externalRepositoryId: 'managed:repository',
      lookupName: null,
    },
    connections,
  };
}

function narrowedTo(projectId: string, resource: TriggerEventResource): ProjectAccessPolicy {
  return policy(projectId, [
    {
      connectionId,
      resources: [
        {kind: resource.kind, externalId: resource.externalId, lookupName: resource.lookupName},
      ],
    },
  ]);
}

function projectsReturning(policies: ProjectAccessPolicy[]) {
  return {
    getProjectAccessPolicies: vi.fn(({projectIds}: {projectIds: string[]}) =>
      Promise.resolve({
        policies: policies.filter((candidate) => projectIds.includes(candidate.projectId)),
      }),
    ),
  };
}

function dispatch(params: {
  workspaceId: string;
  projects: ReturnType<typeof projectsReturning>;
  resource?: TriggerEventResource | undefined;
  eventRef?: string;
}) {
  return dispatchIntegrationEvent({
    workflows,
    projects: params.projects,
    eventRef: params.eventRef ?? crypto.randomUUID(),
    provider: 'github',
    source: 'github',
    event: 'push',
    workspaceId: params.workspaceId,
    connectionId,
    connectionName: 'Acme',
    resource: params.resource ?? null,
    deliveryId: crypto.randomUUID(),
    receivedAt: new Date(),
    payload: {ref: 'main'},
  });
}

async function historyFor(workspaceId: string) {
  const [event] = await db()
    .select()
    .from(triggersReceivedEvents)
    .where(eq(triggersReceivedEvents.workspaceId, workspaceId));
  if (!event) throw new Error('received event not found');
  const decisions = await db()
    .select()
    .from(triggersDecisions)
    .where(eq(triggersDecisions.receivedEventId, event.id));
  return {event, decisions};
}

describe('dispatchIntegrationEvent project access', () => {
  beforeEach(() => {
    startRunFromTrigger.mockReset();
    startRunFromTrigger.mockResolvedValue({id: crypto.randomUUID(), name: 'Build'});
    deliverEventToJobListener.mockReset();
    deliverEventToJobListener.mockResolvedValue({buffered: true, skipped: false});
  });

  test('does not start a workflow in a project narrowed to another repository, and records why', async () => {
    const workspaceId = crypto.randomUUID();
    const narrowed = await triggerSubscriptionFactory.create({
      workspaceId,
      source: 'github',
      event: 'push',
    });
    const open = await triggerSubscriptionFactory.create({
      workspaceId,
      source: 'github',
      event: 'push',
    });
    const projects = projectsReturning([
      narrowedTo(narrowed.projectId, appRepository),
      policy(open.projectId),
    ]);

    await dispatch({workspaceId, projects, resource: otherRepository});

    expect(startRunFromTrigger).toHaveBeenCalledTimes(1);
    expect(startRunFromTrigger).toHaveBeenCalledWith(
      expect.objectContaining({projectId: open.projectId}),
    );
    const {event, decisions} = await historyFor(workspaceId);
    expect(event.resource).toEqual(otherRepository);
    expect(decisions).toHaveLength(2);
    expect(decisions.find((row) => row.subscriptionId === narrowed.id)).toMatchObject({
      decision: 'filtered',
      reason: 'project-access',
      diagnostic: {version: 1, code: 'project-access'},
      runId: null,
    });
    expect(decisions.find((row) => row.subscriptionId === open.id)?.decision).toBe('triggered');
  });

  test('starts the workflow when the event repository is in the narrowed access', async () => {
    const workspaceId = crypto.randomUUID();
    const subscription = await triggerSubscriptionFactory.create({
      workspaceId,
      source: 'github',
      event: 'push',
    });
    const projects = projectsReturning([narrowedTo(subscription.projectId, appRepository)]);

    await dispatch({workspaceId, projects, resource: appRepository});

    expect(startRunFromTrigger).toHaveBeenCalledTimes(1);
  });

  test('discards an event every project filtered out', async () => {
    const workspaceId = crypto.randomUUID();
    const subscription = await triggerSubscriptionFactory.create({
      workspaceId,
      source: 'github',
      event: 'push',
    });
    const projects = projectsReturning([narrowedTo(subscription.projectId, appRepository)]);

    await dispatch({workspaceId, projects, resource: otherRepository});

    const {event} = await historyFor(workspaceId);
    expect(event.outcome).toBe('discarded');
    expect(event.matchedCount).toBe(0);
  });

  test('passes an event with no resource when the connection is listed, and filters it when not', async () => {
    const workspaceId = crypto.randomUUID();
    const listed = await triggerSubscriptionFactory.create({
      workspaceId,
      source: 'github',
      event: 'push',
    });
    const unlisted = await triggerSubscriptionFactory.create({
      workspaceId,
      source: 'github',
      event: 'push',
    });
    const projects = projectsReturning([
      policy(listed.projectId, [{connectionId, resources: [appRepository]}]),
      policy(unlisted.projectId, [{connectionId: crypto.randomUUID(), resources: 'all'}]),
    ]);

    await dispatch({workspaceId, projects});

    expect(startRunFromTrigger).toHaveBeenCalledTimes(1);
    expect(startRunFromTrigger).toHaveBeenCalledWith(
      expect.objectContaining({projectId: listed.projectId}),
    );
    const {decisions} = await historyFor(workspaceId);
    expect(decisions.find((row) => row.subscriptionId === unlisted.id)).toMatchObject({
      decision: 'filtered',
      reason: 'project-access',
    });
  });

  test('skips a project the projects module no longer returns', async () => {
    const workspaceId = crypto.randomUUID();
    const subscription = await triggerSubscriptionFactory.create({
      workspaceId,
      source: 'github',
      event: 'push',
    });

    await dispatch({workspaceId, projects: projectsReturning([])});

    expect(startRunFromTrigger).not.toHaveBeenCalled();
    const {decisions} = await historyFor(workspaceId);
    expect(decisions).toHaveLength(1);
    expect(decisions[0]).toMatchObject({
      subscriptionId: subscription.id,
      decision: 'filtered',
      reason: 'project-deleted',
      diagnostic: {version: 1, code: 'project-deleted'},
    });
  });

  test('loads policies in batches of 100 distinct projects', async () => {
    const workspaceId = crypto.randomUUID();
    const projectIds = Array.from({length: 250}, () => crypto.randomUUID());
    await Promise.all(
      projectIds.map((projectId) =>
        triggerSubscriptionFactory.create({
          workspaceId,
          projectId,
          source: 'github',
          event: 'push',
        }),
      ),
    );
    // A second subscription in a loaded project does not add a second request.
    await triggerSubscriptionFactory.create({
      workspaceId,
      projectId: projectIds[0] as string,
      source: 'github',
      event: 'push',
    });
    const projects = projectsReturning(projectIds.map((projectId) => policy(projectId)));

    await dispatch({workspaceId, projects});

    expect(
      projects.getProjectAccessPolicies.mock.calls.map(([input]) => input.projectIds.length),
    ).toEqual([100, 100, 50]);
    expect(startRunFromTrigger).toHaveBeenCalledTimes(251);
  }, 30_000);

  test('replays the event when the policies cannot be read, and starts nothing', async () => {
    const workspaceId = crypto.randomUUID();
    await triggerSubscriptionFactory.create({workspaceId, source: 'github', event: 'push'});
    const projects = {
      getProjectAccessPolicies: vi.fn().mockRejectedValue(new Error('unavailable')),
    };

    await expect(dispatch({workspaceId, projects, resource: appRepository})).rejects.toThrow(
      'unavailable',
    );

    expect(startRunFromTrigger).not.toHaveBeenCalled();
    const {event} = await historyFor(workspaceId);
    expect(event.outcome).toBe('failed');
    expect(event.processingDiagnostic).toEqual({version: 1, code: 'subscription-load-failed'});
  });

  test('does not deliver to a listening job whose project excludes the repository', async () => {
    const workspaceId = crypto.randomUUID();
    const projectId = crypto.randomUUID();
    const listener = await jobListenerSubscriptionFactory.create({
      workspaceId,
      projectId,
      source: 'github',
      event: 'push',
    });
    const projects = projectsReturning([narrowedTo(projectId, appRepository)]);

    await dispatch({workspaceId, projects, resource: otherRepository});

    expect(deliverEventToJobListener).not.toHaveBeenCalled();
    const {decisions} = await historyFor(workspaceId);
    expect(decisions).toHaveLength(1);
    expect(decisions[0]).toMatchObject({
      subscriptionKind: 'listener',
      subscriptionId: listener.id,
      projectId,
      decision: 'filtered',
      reason: 'project-access',
    });
  });

  test('delivers to a listening job whose project takes the repository, and to one projected before projects were recorded', async () => {
    const workspaceId = crypto.randomUUID();
    const projectId = crypto.randomUUID();
    const allowed = await jobListenerSubscriptionFactory.create({
      workspaceId,
      projectId,
      source: 'github',
      event: 'push',
    });
    const unrecorded = await jobListenerSubscriptionFactory.create({
      workspaceId,
      projectId: null,
      source: 'github',
      event: 'push',
    });
    const projects = projectsReturning([narrowedTo(projectId, appRepository)]);

    await dispatch({workspaceId, projects, resource: appRepository});

    expect(deliverEventToJobListener.mock.calls.map(([input]) => input.jobId).sort()).toEqual(
      [allowed.jobId, unrecorded.jobId].sort(),
    );
  });

  test('filters nothing without a projects client', async () => {
    const workspaceId = crypto.randomUUID();
    await triggerSubscriptionFactory.create({workspaceId, source: 'github', event: 'push'});

    await dispatchIntegrationEvent({
      workflows,
      eventRef: crypto.randomUUID(),
      provider: 'github',
      source: 'github',
      event: 'push',
      workspaceId,
      connectionId,
      connectionName: null,
      deliveryId: crypto.randomUUID(),
      receivedAt: new Date(),
      payload: {},
    });

    expect(startRunFromTrigger).toHaveBeenCalledTimes(1);
  });
});
