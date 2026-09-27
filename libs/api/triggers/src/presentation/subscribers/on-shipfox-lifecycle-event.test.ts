import {
  SHIPFOX_BUILTIN_CONNECTION_ID,
  type ShipfoxEventName,
} from '@shipfox/api-integration-shipfox-dto';
import type {DomainEvent} from '@shipfox/node-outbox';
import {eq} from 'drizzle-orm';
import {db} from '#db/db.js';
import {triggersDecisions} from '#db/schema/decisions.js';
import {triggersReceivedEvents} from '#db/schema/received-events.js';
import {jobListenerSubscriptionFactory, triggerSubscriptionFactory} from '#test/index.js';
import {createOnShipfoxLifecycleEvent} from './on-shipfox-lifecycle-event.js';

const createdAt = '2026-09-26T10:00:00.000Z';
const finishedAt = '2026-09-26T10:05:00.000Z';

let workspaceId: string;
let ids: {project: string; run: string; attempt: string; job: string; execution: string};
let startRunFromTrigger: ReturnType<typeof vi.fn>;
let deliverEventToJobListener: ReturnType<typeof vi.fn>;
let resolveWorkflowRunTriggerReference: ReturnType<typeof vi.fn>;
let getLifecycleEventContext: ReturnType<typeof vi.fn>;

function context(overrides: {attempt?: number; outputs?: Record<string, unknown> | null} = {}) {
  return {
    project: {id: ids.project, name: 'api'},
    workflow: {id: ids.run, name: 'Build', path: '.shipfox/workflows/build.yml'},
    run: {
      id: ids.run,
      number: 42,
      attempt: overrides.attempt ?? 1,
      name: 'Build',
      origin: 'synced' as const,
      trigger: {source: 'manual', event: 'fire'},
      ref: null,
      commit: null,
      parent_run_id: null,
      root_run_id: null,
      created_at: createdAt,
      outputs: overrides.outputs ?? null,
    },
    job: {id: ids.job, key: 'deploy', mode: 'listening' as const, outputs: {version: '1.2.3'}},
  };
}

function workflowsClient() {
  return {
    getLifecycleEventContext,
    startRunFromTrigger,
    deliverEventToJobListener,
    resolveWorkflowRunTriggerReference,
  } as never;
}

function terminated(overrides: Record<string, unknown> = {}) {
  return {
    workspaceId,
    workflowRunAttemptId: ids.attempt,
    status: 'succeeded',
    statusReason: null,
    startedAt: createdAt,
    finishedAt,
    ...overrides,
  };
}

function outboxEvent(payload: Record<string, unknown>, id = crypto.randomUUID()) {
  return {
    id,
    type: 'workflows.workflow_run.terminated',
    payload: payload as never,
    createdAt: new Date(finishedAt),
  } satisfies DomainEvent<never>;
}

function deliver(
  eventName: ShipfoxEventName,
  payload: Record<string, unknown>,
  event = outboxEvent(payload),
) {
  return createOnShipfoxLifecycleEvent(workflowsClient(), eventName)(payload as never, event);
}

async function receivedEvent(eventRef: string) {
  const [row] = await db()
    .select()
    .from(triggersReceivedEvents)
    .where(eq(triggersReceivedEvents.eventRef, eventRef));
  return row;
}

function decisionsForEvent(receivedEventId: string) {
  return db()
    .select()
    .from(triggersDecisions)
    .where(eq(triggersDecisions.receivedEventId, receivedEventId));
}

function subscribe(params: {event?: string; filter?: string} = {}) {
  return triggerSubscriptionFactory.create({
    workspaceId,
    source: 'shipfox',
    event: params.event ?? 'run.completed',
    config: params.filter === undefined ? {} : {filter: params.filter},
  });
}

describe('Shipfox lifecycle subscriber', () => {
  beforeEach(() => {
    workspaceId = crypto.randomUUID();
    ids = {
      project: crypto.randomUUID(),
      run: crypto.randomUUID(),
      attempt: crypto.randomUUID(),
      job: crypto.randomUUID(),
      execution: crypto.randomUUID(),
    };
    getLifecycleEventContext = vi.fn().mockResolvedValue(context());
    startRunFromTrigger = vi
      .fn()
      .mockResolvedValue({id: crypto.randomUUID(), name: 'Chained workflow'});
    deliverEventToJobListener = vi.fn().mockResolvedValue({buffered: true, skipped: false});
    resolveWorkflowRunTriggerReference = vi.fn().mockResolvedValue(null);
  });

  test('fires a trigger on a successful run with its workflow outputs', async () => {
    const subscription = await subscribe();
    getLifecycleEventContext.mockResolvedValue(context({outputs: {version: '1.2.3'}}));
    const event = outboxEvent(terminated());

    await deliver('run.completed', terminated(), event);

    expect(getLifecycleEventContext).toHaveBeenCalledWith({
      workspaceId,
      workflowRunAttemptId: ids.attempt,
    });
    expect(startRunFromTrigger).toHaveBeenCalledTimes(1);
    expect(startRunFromTrigger).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId,
        projectId: subscription.projectId,
        definitionId: subscription.workflowDefinitionId,
        triggerConnectionId: SHIPFOX_BUILTIN_CONNECTION_ID,
        idempotencyKey: `${subscription.id}:${event.id}`,
        triggerPayload: {
          provider: 'shipfox',
          source: 'shipfox',
          event: 'run.completed',
          deliveryId: event.id,
          data: expect.objectContaining({
            run: expect.objectContaining({
              id: ids.run,
              attempt: 1,
              status: 'succeeded',
              status_reason: null,
              started_at: createdAt,
              finished_at: finishedAt,
              outputs: {version: '1.2.3'},
            }),
          }),
        },
      }),
    );
    const received = await receivedEvent(event.id);
    expect(received).toMatchObject({
      provider: 'shipfox',
      source: 'shipfox',
      event: 'run.completed',
      deliveryId: event.id,
      connectionId: SHIPFOX_BUILTIN_CONNECTION_ID,
      outcome: 'routed',
    });
  });

  test('fires a subscription without an event on run.completed', async () => {
    await triggerSubscriptionFactory.create({workspaceId, source: 'shipfox', event: null});

    await deliver('run.completed', terminated());

    expect(startRunFromTrigger).toHaveBeenCalledTimes(1);
  });

  test('does not fire a trigger whose filter rejects the event', async () => {
    await subscribe({filter: 'event.run.status == "succeeded"'});
    const payload = terminated({status: 'failed', statusReason: 'job_failed'});
    const event = outboxEvent(payload);

    await deliver('run.completed', payload, event);

    expect(startRunFromTrigger).not.toHaveBeenCalled();
    expect(await receivedEvent(event.id)).toMatchObject({outcome: 'discarded'});
  });

  test('delivers run.completed to a listening job', async () => {
    const jobId = crypto.randomUUID();
    await jobListenerSubscriptionFactory.create({
      workspaceId,
      jobId,
      source: 'shipfox',
      event: 'run.completed',
    });
    const event = outboxEvent(terminated());

    await deliver('run.completed', terminated(), event);

    expect(startRunFromTrigger).not.toHaveBeenCalled();
    expect(resolveWorkflowRunTriggerReference).toHaveBeenCalledWith(
      expect.objectContaining({workspaceId, triggerConnectionId: SHIPFOX_BUILTIN_CONNECTION_ID}),
    );
    expect(deliverEventToJobListener).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId,
        provider: 'shipfox',
        source: 'shipfox',
        event: 'run.completed',
        eventRef: event.id,
        deliveryId: event.id,
        triggerConnectionId: SHIPFOX_BUILTIN_CONNECTION_ID,
        payload: expect.objectContaining({
          run: expect.objectContaining({status: 'succeeded'}),
        }),
      }),
    );
    expect(await receivedEvent(event.id)).toMatchObject({outcome: 'routed'});
  });

  test('a replayed outbox delivery reuses the idempotency key and records one event', async () => {
    const subscription = await subscribe();
    const runsByKey = new Map<string, {id: string; name: string}>();
    startRunFromTrigger.mockImplementation(({idempotencyKey}: {idempotencyKey: string}) => {
      const run = runsByKey.get(idempotencyKey) ?? {id: crypto.randomUUID(), name: 'Chained'};
      runsByKey.set(idempotencyKey, run);
      return Promise.resolve(run);
    });
    const event = outboxEvent(terminated());

    await deliver('run.completed', terminated(), event);
    await deliver('run.completed', terminated(), event);

    expect(runsByKey).toEqual(new Map([[`${subscription.id}:${event.id}`, expect.anything()]]));
    const received = await receivedEvent(event.id);
    if (!received) throw new Error('received event not found');
    expect(received.outcome).toBe('routed');
    const decisions = await decisionsForEvent(received.id);
    expect(decisions).toEqual([
      expect.objectContaining({subscriptionId: subscription.id, decision: 'triggered'}),
    ]);
  });

  test('records nothing when no subscription matches', async () => {
    await subscribe({event: 'run.started'});
    await triggerSubscriptionFactory.create({source: 'shipfox', event: 'run.completed'});
    const event = outboxEvent(terminated());

    await deliver('run.completed', terminated(), event);

    expect(getLifecycleEventContext).not.toHaveBeenCalled();
    expect(startRunFromTrigger).not.toHaveBeenCalled();
    expect(await receivedEvent(event.id)).toBeUndefined();
  });

  test('skips events written before they carried a workspace', async () => {
    await subscribe();
    const {workspaceId: _, ...payload} = terminated();

    await deliver('run.completed', payload);

    expect(getLifecycleEventContext).not.toHaveBeenCalled();
    expect(startRunFromTrigger).not.toHaveBeenCalled();
  });

  test('a dispatch delayed until after a rerun carries the first attempt facts', async () => {
    await subscribe();
    const rerunAttemptId = crypto.randomUUID();
    getLifecycleEventContext.mockImplementation(
      ({workflowRunAttemptId}: {workflowRunAttemptId: string}) =>
        Promise.resolve(
          workflowRunAttemptId === rerunAttemptId
            ? context({attempt: 2, outputs: {version: '2.0.0'}})
            : context({attempt: 1}),
        ),
    );
    const payload = terminated({status: 'failed', statusReason: 'job_failed'});

    await deliver('run.completed', payload);

    expect(getLifecycleEventContext).toHaveBeenCalledWith({
      workspaceId,
      workflowRunAttemptId: ids.attempt,
    });
    expect(startRunFromTrigger).toHaveBeenCalledWith(
      expect.objectContaining({
        triggerPayload: expect.objectContaining({
          data: expect.objectContaining({
            run: expect.objectContaining({
              attempt: 1,
              status: 'failed',
              status_reason: 'job_failed',
              finished_at: finishedAt,
              outputs: null,
            }),
          }),
        }),
      }),
    );
  });

  it.each<[ShipfoxEventName, Record<string, unknown>]>([
    ['run.requested', {status: 'pending'}],
    ['run.started', {startedAt: createdAt}],
  ])('dispatches %s', async (eventName, facts) => {
    await subscribe({event: eventName});

    await deliver(eventName, {workspaceId, workflowRunAttemptId: ids.attempt, ...facts});

    expect(startRunFromTrigger).toHaveBeenCalledWith(
      expect.objectContaining({triggerPayload: expect.objectContaining({event: eventName})}),
    );
  });

  it.each<[ShipfoxEventName, Record<string, unknown>]>([
    [
      'job.queued',
      {jobExecutionId: crypto.randomUUID(), executionSequence: 2, queuedAt: createdAt},
    ],
    [
      'job.started',
      {
        jobExecutionId: crypto.randomUUID(),
        executionSequence: 2,
        runnerLabels: ['linux'],
        startedAt: createdAt,
      },
    ],
  ])('uses the job context for %s', async (eventName, facts) => {
    await subscribe({event: eventName});

    await deliver(eventName, {
      ...facts,
      jobId: ids.job,
      workflowRunAttemptId: ids.attempt,
      workspaceId,
    });

    expect(getLifecycleEventContext).toHaveBeenCalledWith({
      workspaceId,
      workflowRunAttemptId: ids.attempt,
      jobId: ids.job,
    });
  });

  test('dispatches skipped job.completed with null outputs', async () => {
    await subscribe({event: 'job.completed'});

    await deliver('job.completed', {
      jobId: ids.job,
      workflowRunAttemptId: ids.attempt,
      workspaceId,
      status: 'skipped',
      statusReason: null,
      finishedAt: createdAt,
    });

    expect(startRunFromTrigger).toHaveBeenCalledWith(
      expect.objectContaining({
        triggerPayload: expect.objectContaining({
          data: expect.objectContaining({
            job: expect.objectContaining({status: 'skipped', outputs: null}),
          }),
        }),
      }),
    );
  });
});
