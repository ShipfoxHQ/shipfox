import {workflowsInterModuleContract} from '@shipfox/api-workflows-dto/inter-module';
import {createInterModuleKnownError} from '@shipfox/inter-module';
import {eq} from 'drizzle-orm';
import {db} from '#db/db.js';
import {triggersDecisions} from '#db/schema/decisions.js';
import {triggersReceivedEvents} from '#db/schema/received-events.js';
import {triggerSubscriptionFactory} from '#test/index.js';
import {TriggerSubscriptionNotManualError} from './errors.js';

const runWorkflow = vi.fn();
const getSecret = vi.fn();

const {fireManualSubscription, fireManualTrigger} = await import('./fire-manual.js');
const {pinSecretInputs} = await import('./pin-secret-inputs.js');

const workflows = {startRunFromTrigger: (...args: unknown[]) => runWorkflow(...args)} as never;
const secrets = {getSecret};

function eventsForWorkspace(workspaceId: string) {
  return db()
    .select()
    .from(triggersReceivedEvents)
    .where(eq(triggersReceivedEvents.workspaceId, workspaceId));
}

function decisionsForEvent(receivedEventId: string) {
  return db()
    .select()
    .from(triggersDecisions)
    .where(eq(triggersDecisions.receivedEventId, receivedEventId));
}

describe('fireManualSubscription (trigger history)', () => {
  beforeEach(() => {
    runWorkflow.mockReset();
    getSecret.mockReset();
  });

  test.each([
    ['neither', {}],
    ['both', {userId: crypto.randomUUID(), parentRun: {runId: crypto.randomUUID()}}],
  ] as const)('rejects %s caller forms without side effects', async (_label, caller) => {
    const subscription = await triggerSubscriptionFactory.create({
      source: 'manual',
      event: 'fire',
      config: {},
    });
    const callerError = 'Exactly one of userId or parentRun must be provided';

    await expect(
      fireManualTrigger({
        workflows,
        workspaceId: subscription.workspaceId,
        definitionId: subscription.workflowDefinitionId,
        ...caller,
      }),
    ).rejects.toThrow(callerError);
    await expect(
      fireManualSubscription({
        workflows,
        subscriptionId: subscription.id,
        callerWorkspaceId: subscription.workspaceId,
        ...caller,
      }),
    ).rejects.toThrow(callerError);

    expect(runWorkflow).not.toHaveBeenCalled();
    expect(await eventsForWorkspace(subscription.workspaceId)).toHaveLength(0);
  });

  test('passes a caller idempotency key through and returns deduplication', async () => {
    const subscription = await triggerSubscriptionFactory.create({
      source: 'manual',
      event: 'fire',
      config: {},
    });
    const run = {id: crypto.randomUUID(), name: 'Manual run', deduplicated: true as const};
    runWorkflow.mockResolvedValue(run);

    const result = await fireManualTrigger({
      workflows,
      workspaceId: subscription.workspaceId,
      definitionId: subscription.workflowDefinitionId,
      userId: crypto.randomUUID(),
      idempotencyKey: 'retry-key',
    });

    expect(result).toEqual({...run, deduplicated: true});
    expect(runWorkflow).toHaveBeenCalledWith(
      expect.objectContaining({idempotencyKey: 'retry-key'}),
    );
  });

  test.each([
    ['no caller map uses defaults', undefined, {DEPLOY_TOKEN: 'PROJECT_TOKEN'}],
    [
      'a complete caller map replaces defaults',
      {DEPLOY_TOKEN: {key: 'OVERRIDE_TOKEN', projectId: null}},
      {DEPLOY_TOKEN: 'OVERRIDE_TOKEN'},
    ],
  ] as const)('applies the manual secret override rule: %s', async (_label, callerMap, expected) => {
    const subscription = await triggerSubscriptionFactory.create({
      source: 'manual',
      event: 'fire',
      config: {secrets: {DEPLOY_TOKEN: 'PROJECT_TOKEN'}},
    });
    const run = {id: crypto.randomUUID(), name: 'Manual run'};
    runWorkflow.mockResolvedValue(run);
    getSecret.mockImplementation(async ({key}: {key: string}) => ({
      value: key,
      projectId: key === 'OVERRIDE_TOKEN' ? null : subscription.projectId,
    }));

    await fireManualSubscription({
      workflows,
      secrets,
      subscriptionId: subscription.id,
      callerWorkspaceId: subscription.workspaceId,
      userId: crypto.randomUUID(),
      ...(callerMap === undefined ? {} : {secretInputs: callerMap}),
    });

    const [payload] = runWorkflow.mock.calls[0] as [Record<string, unknown>];
    expect(payload.secretInputs).toEqual(
      Object.fromEntries(
        Object.entries(expected).map(([name, key]) => [
          name,
          {
            store: 'local',
            key,
            projectId: key === 'OVERRIDE_TOKEN' ? null : subscription.projectId,
          },
        ]),
      ),
    );
  });

  test('rejects an empty or partial manual secret override by declared name', async () => {
    const subscription = await triggerSubscriptionFactory.create({
      source: 'manual',
      event: 'fire',
      config: {secrets: {DEPLOY_TOKEN: 'PROJECT_TOKEN'}},
    });

    await expect(
      fireManualSubscription({
        workflows,
        secrets,
        subscriptionId: subscription.id,
        callerWorkspaceId: subscription.workspaceId,
        userId: crypto.randomUUID(),
        secretInputs: {},
      }),
    ).rejects.toMatchObject({code: 'secret-input-missing', key: 'DEPLOY_TOKEN'});
    expect(runWorkflow).not.toHaveBeenCalled();
  });

  test('records a routed workflow event and forwards its parent run', async () => {
    const subscription = await triggerSubscriptionFactory.create({
      source: 'manual',
      event: 'fire',
      config: {},
    });
    const parentRun = {runId: crypto.randomUUID()};
    const run = {id: crypto.randomUUID(), name: 'Child run'};
    runWorkflow.mockResolvedValue(run);

    const result = await fireManualTrigger({
      workflows,
      workspaceId: subscription.workspaceId,
      definitionId: subscription.workflowDefinitionId,
      parentRun,
    });

    expect(result).toEqual({...run, deduplicated: false});
    expect(runWorkflow).toHaveBeenCalledWith(
      expect.objectContaining({
        parentRun,
        triggerPayload: expect.objectContaining({parentRun}),
      }),
    );
    const [event] = await db()
      .select()
      .from(triggersReceivedEvents)
      .where(eq(triggersReceivedEvents.eventRef, run.id));
    if (!event) throw new Error('received event not found');
    expect(event.origin).toBe('workflow');
    expect(event.outcome).toBe('routed');
  });

  test('pins an own __proto__ secret input key', async () => {
    const projectId = crypto.randomUUID();
    const workspaceId = crypto.randomUUID();
    getSecret.mockResolvedValue({value: 'project-secret-value', projectId});

    const pinned = await pinSecretInputs({
      secrets,
      workspaceId,
      resolutionProjectId: projectId,
      secretInputs: {['__proto__']: 'PROJECT_TOKEN'},
    });

    expect(Object.hasOwn(pinned, '__proto__')).toBe(true);
    expect(Object.getOwnPropertyDescriptor(pinned, '__proto__')?.value).toEqual({
      store: 'local',
      key: 'PROJECT_TOKEN',
      projectId,
    });
  });

  test('pins a project-scoped secret input without retaining its value', async () => {
    const subscription = await triggerSubscriptionFactory.create({
      source: 'manual',
      event: 'fire',
      config: {},
    });
    const secretValue = 'project-secret-value';
    getSecret.mockResolvedValue({value: secretValue, projectId: subscription.projectId});
    runWorkflow.mockResolvedValue({id: crypto.randomUUID(), name: 'Manual run'});

    await fireManualSubscription({
      workflows,
      secrets,
      subscriptionId: subscription.id,
      callerWorkspaceId: subscription.workspaceId,
      userId: crypto.randomUUID(),
      secretInputs: {DEPLOY_TOKEN: {key: 'PROJECT_TOKEN', projectId: subscription.projectId}},
    });

    expect(getSecret).toHaveBeenCalledWith({
      workspaceId: subscription.workspaceId,
      projectId: subscription.projectId,
      namespace: '',
      key: 'PROJECT_TOKEN',
      store: 'local',
    });
    const [payload] = runWorkflow.mock.calls[0] as [Record<string, unknown>];
    expect(payload.secretInputs).toEqual({
      DEPLOY_TOKEN: {store: 'local', key: 'PROJECT_TOKEN', projectId: subscription.projectId},
    });
    expect(JSON.stringify(payload)).not.toContain(secretValue);
  });

  test('pins a workspace-scoped secret input when project lookup falls back to workspace', async () => {
    const subscription = await triggerSubscriptionFactory.create({
      source: 'manual',
      event: 'fire',
      config: {},
    });
    getSecret.mockResolvedValue({value: 'workspace-secret-value', projectId: null});
    runWorkflow.mockResolvedValue({id: crypto.randomUUID(), name: 'Manual run'});

    await fireManualSubscription({
      workflows,
      secrets,
      subscriptionId: subscription.id,
      callerWorkspaceId: subscription.workspaceId,
      userId: crypto.randomUUID(),
      secretInputs: {DEPLOY_TOKEN: {key: 'WORKSPACE_TOKEN', projectId: subscription.projectId}},
    });

    expect(getSecret).toHaveBeenCalledWith({
      workspaceId: subscription.workspaceId,
      projectId: subscription.projectId,
      namespace: '',
      key: 'WORKSPACE_TOKEN',
      store: 'local',
    });
    const [payload] = runWorkflow.mock.calls[0] as [Record<string, unknown>];
    expect(payload.secretInputs).toEqual({
      DEPLOY_TOKEN: {store: 'local', key: 'WORKSPACE_TOKEN', projectId: null},
    });
  });

  test('rejects an unknown secret input before creating a run', async () => {
    const subscription = await triggerSubscriptionFactory.create({
      source: 'manual',
      event: 'fire',
      config: {},
    });
    getSecret.mockResolvedValue({value: null, projectId: null});

    await expect(
      fireManualSubscription({
        workflows,
        secrets,
        subscriptionId: subscription.id,
        callerWorkspaceId: subscription.workspaceId,
        userId: crypto.randomUUID(),
        secretInputs: {DEPLOY_TOKEN: {key: 'MISSING_TOKEN', projectId: subscription.projectId}},
      }),
    ).rejects.toMatchObject({name: 'SecretInputNotFoundError', key: 'MISSING_TOKEN'});
    expect(runWorkflow).not.toHaveBeenCalled();
  });

  test('fails a missing default secret before creating a run', async () => {
    const subscription = await triggerSubscriptionFactory.create({
      source: 'manual',
      event: 'fire',
      config: {secrets: {DEPLOY_TOKEN: 'MISSING_TOKEN'}},
    });
    getSecret.mockResolvedValue({value: null, projectId: null});

    await expect(
      fireManualSubscription({
        workflows,
        secrets,
        subscriptionId: subscription.id,
        callerWorkspaceId: subscription.workspaceId,
        userId: crypto.randomUUID(),
      }),
    ).rejects.toMatchObject({name: 'SecretInputNotFoundError', key: 'MISSING_TOKEN'});
    expect(runWorkflow).not.toHaveBeenCalled();
  });

  test('records a routed manual event and a triggered decision on success', async () => {
    const subscription = await triggerSubscriptionFactory.create({
      source: 'manual',
      event: 'fire',
      config: {},
    });
    const run = {id: crypto.randomUUID(), name: 'Manual run'};
    runWorkflow.mockResolvedValue(run);

    const result = await fireManualSubscription({
      workflows,
      subscriptionId: subscription.id,
      callerWorkspaceId: subscription.workspaceId,
      userId: crypto.randomUUID(),
    });

    expect(result).toEqual(run);
    const [payload] = runWorkflow.mock.calls[0] as [Record<string, unknown>];
    expect(payload).not.toHaveProperty('inputs');
    const [event] = await db()
      .select()
      .from(triggersReceivedEvents)
      .where(eq(triggersReceivedEvents.eventRef, run.id));
    if (!event) throw new Error('received event not found');
    expect(event.origin).toBe('manual');
    expect(event.outcome).toBe('routed');
    expect(event.matchedCount).toBe(1);
    const decisions = await decisionsForEvent(event.id);
    expect(decisions).toHaveLength(1);
    expect(decisions[0]?.decision).toBe('triggered');
    expect(decisions[0]?.runId).toBe(run.id);
    expect(decisions[0]?.runName).toBe('Manual run');
  });

  test('records a failed manual event with a dispatch-error decision and re-throws when runWorkflow throws', async () => {
    const subscription = await triggerSubscriptionFactory.create({
      source: 'manual',
      event: 'fire',
      config: {},
    });
    runWorkflow.mockRejectedValue(new Error('manual boom'));

    await expect(
      fireManualSubscription({
        workflows,
        subscriptionId: subscription.id,
        callerWorkspaceId: subscription.workspaceId,
        userId: crypto.randomUUID(),
      }),
    ).rejects.toThrow('manual boom');

    const events = await eventsForWorkspace(subscription.workspaceId);
    expect(events).toHaveLength(1);
    const event = events[0];
    if (!event) throw new Error('received event not found');
    expect(event.origin).toBe('manual');
    expect(event.outcome).toBe('failed');
    expect(event.matchedCount).toBe(1);
    expect(event.processedAt).toBeNull();
    const decisions = await decisionsForEvent(event.id);
    expect(decisions).toHaveLength(1);
    expect(decisions[0]?.decision).toBe('dispatch-error');
    expect(decisions[0]?.reason).toContain('manual boom');
  });

  test('records an errored (terminal) manual event when runWorkflow fails permanently', async () => {
    const subscription = await triggerSubscriptionFactory.create({
      source: 'manual',
      event: 'fire',
      config: {},
    });
    runWorkflow.mockRejectedValue(
      createInterModuleKnownError(
        workflowsInterModuleContract.methods.startRunFromTrigger,
        'definition-not-found',
        {definitionId: crypto.randomUUID()},
      ),
    );

    await expect(
      fireManualSubscription({
        workflows,
        subscriptionId: subscription.id,
        callerWorkspaceId: subscription.workspaceId,
        userId: crypto.randomUUID(),
      }),
    ).rejects.toThrow('definition-not-found');

    const events = await eventsForWorkspace(subscription.workspaceId);
    expect(events).toHaveLength(1);
    const event = events[0];
    if (!event) throw new Error('received event not found');
    expect(event.outcome).toBe('errored');
    expect(event.matchedCount).toBe(1);
    expect(event.processedAt).toBeInstanceOf(Date);
    const decisions = await decisionsForEvent(event.id);
    expect(decisions[0]?.decision).toBe('dispatch-error');
    expect(decisions[0]?.reason).toContain('definition-not-found');
  });

  test('records an admission denial reason as a terminal manual event', async () => {
    const subscription = await triggerSubscriptionFactory.create({
      source: 'manual',
      event: 'fire',
      config: {},
    });
    const reason = 'billing-payment-method-required';
    runWorkflow.mockRejectedValue(
      createInterModuleKnownError(
        workflowsInterModuleContract.methods.startRunFromTrigger,
        'admission-denied',
        {workspaceId: subscription.workspaceId, reason},
      ),
    );

    await expect(
      fireManualSubscription({
        workflows,
        subscriptionId: subscription.id,
        callerWorkspaceId: subscription.workspaceId,
        userId: crypto.randomUUID(),
      }),
    ).rejects.toMatchObject({code: 'admission-denied'});

    const [event] = await eventsForWorkspace(subscription.workspaceId);
    if (!event) throw new Error('received event not found');
    expect(event.outcome).toBe('errored');
    const [decision] = await decisionsForEvent(event.id);
    expect(decision).toMatchObject({decision: 'dispatch-error', reason});
  });

  test('falls back to fire in history when a bad row stores a NULL event', async () => {
    const subscription = await triggerSubscriptionFactory.create({
      source: 'manual',
      event: null,
      config: {},
    });
    const run = {id: crypto.randomUUID(), name: 'Manual run'};
    runWorkflow.mockResolvedValue(run);

    await fireManualSubscription({
      workflows,
      subscriptionId: subscription.id,
      callerWorkspaceId: subscription.workspaceId,
      userId: crypto.randomUUID(),
    });

    const [event] = await db()
      .select()
      .from(triggersReceivedEvents)
      .where(eq(triggersReceivedEvents.eventRef, run.id));
    if (!event) throw new Error('received event not found');
    expect(event.event).toBe('fire');
    expect(event.outcome).toBe('routed');
  });

  test('does not record a received event when the subscription is not a manual trigger', async () => {
    const subscription = await triggerSubscriptionFactory.create({
      source: 'github',
      event: 'push',
      config: {},
    });

    await expect(
      fireManualSubscription({
        workflows,
        subscriptionId: subscription.id,
        callerWorkspaceId: subscription.workspaceId,
        userId: crypto.randomUUID(),
      }),
    ).rejects.toThrow(TriggerSubscriptionNotManualError);

    expect(await eventsForWorkspace(subscription.workspaceId)).toHaveLength(0);
    expect(runWorkflow).not.toHaveBeenCalled();
  });
});
