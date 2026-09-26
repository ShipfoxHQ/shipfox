import type {ShipfoxEventName} from '@shipfox/api-integration-shipfox-dto';
import type {DomainEvent} from '@shipfox/node-outbox';
import {dispatchIntegrationEvent} from '#core/dispatch-integration-event.js';
import {findMatchingJobListenerSubscriptions} from '#db/job-listener-subscriptions.js';
import {findMatchingSubscriptions} from '#db/subscriptions.js';
import {createOnShipfoxLifecycleEvent} from './on-shipfox-lifecycle-event.js';

vi.mock('#db/job-listener-subscriptions.js', () => ({
  findMatchingJobListenerSubscriptions: vi.fn(),
}));
vi.mock('#db/subscriptions.js', () => ({findMatchingSubscriptions: vi.fn()}));
vi.mock('#core/dispatch-integration-event.js', () => ({dispatchIntegrationEvent: vi.fn()}));

const findSubscriptionsMock = vi.mocked(findMatchingSubscriptions);
const findListenersMock = vi.mocked(findMatchingJobListenerSubscriptions);
const dispatchMock = vi.mocked(dispatchIntegrationEvent);

const ids = {
  workspace: '00000000-0000-4000-8000-000000000001',
  project: '00000000-0000-4000-8000-000000000002',
  run: '00000000-0000-4000-8000-000000000003',
  attempt: '00000000-0000-4000-8000-000000000004',
  job: '00000000-0000-4000-8000-000000000005',
  execution: '00000000-0000-4000-8000-000000000006',
};
const createdAt = '2026-09-26T10:00:00.000Z';

function context() {
  return {
    project: {id: ids.project, name: 'api'},
    workflow: {id: ids.run, name: 'Build', path: '.shipfox/workflows/build.yml'},
    run: {
      id: ids.run,
      number: 42,
      attempt: 1,
      name: 'Build',
      origin: 'synced' as const,
      trigger: {source: 'manual', event: 'fire'},
      ref: null,
      commit: null,
      parent_run_id: null,
      root_run_id: null,
      created_at: createdAt,
    },
    job: {id: ids.job, key: 'deploy', mode: 'listening' as const, outputs: {version: '1.2.3'}},
  };
}

function event(payload: Record<string, unknown>): DomainEvent<never> {
  return {
    id: crypto.randomUUID(),
    type: 'workflows.lifecycle',
    payload: payload as never,
    createdAt: new Date(createdAt),
  };
}

describe('Shipfox lifecycle subscriber', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findSubscriptionsMock.mockResolvedValue([{id: 'subscription'} as never]);
    findListenersMock.mockResolvedValue([]);
    dispatchMock.mockResolvedValue();
  });

  it.each<[ShipfoxEventName, Record<string, unknown>]>([
    [
      'run.requested',
      {workspaceId: ids.workspace, workflowRunAttemptId: ids.attempt, status: 'pending'},
    ],
    [
      'run.started',
      {workspaceId: ids.workspace, workflowRunAttemptId: ids.attempt, startedAt: createdAt},
    ],
    [
      'run.completed',
      {
        workspaceId: ids.workspace,
        workflowRunAttemptId: ids.attempt,
        projectId: ids.project,
        status: 'succeeded',
        statusReason: null,
        startedAt: createdAt,
        finishedAt: createdAt,
      },
    ],
  ])('dispatches %s', async (eventName, payload) => {
    const workflows = {getLifecycleEventContext: vi.fn().mockResolvedValue(context())} as never;

    await createOnShipfoxLifecycleEvent(workflows, eventName)(payload as never, event(payload));

    expect(dispatchMock).toHaveBeenCalledWith(
      expect.objectContaining({event: eventName, source: 'shipfox', provider: 'shipfox'}),
    );
  });

  it.each<[ShipfoxEventName, Record<string, unknown>]>([
    ['job.queued', {jobExecutionId: ids.execution, executionSequence: 2, queuedAt: createdAt}],
    [
      'job.started',
      {
        jobExecutionId: ids.execution,
        executionSequence: 2,
        runnerLabels: ['linux'],
        startedAt: createdAt,
      },
    ],
  ])('uses the job context for %s', async (eventName, facts) => {
    const getContext = vi.fn().mockResolvedValue(context());
    const workflows = {getLifecycleEventContext: getContext} as never;
    const payload = {
      ...facts,
      jobId: ids.job,
      workflowRunAttemptId: ids.attempt,
      workspaceId: ids.workspace,
    };

    await createOnShipfoxLifecycleEvent(workflows, eventName)(payload as never, event(payload));

    expect(getContext).toHaveBeenCalledWith({
      workspaceId: ids.workspace,
      workflowRunAttemptId: ids.attempt,
      jobId: ids.job,
    });
  });

  it('dispatches skipped job.completed with null outputs', async () => {
    const workflows = {getLifecycleEventContext: vi.fn().mockResolvedValue(context())} as never;
    const payload = {
      jobId: ids.job,
      workflowRunAttemptId: ids.attempt,
      workspaceId: ids.workspace,
      status: 'skipped',
      statusReason: null,
      finishedAt: createdAt,
    };

    await createOnShipfoxLifecycleEvent(workflows, 'job.completed')(
      payload as never,
      event(payload),
    );

    expect(dispatchMock).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          job: expect.objectContaining({status: 'skipped', outputs: null}),
        }),
      }),
    );
  });
});
