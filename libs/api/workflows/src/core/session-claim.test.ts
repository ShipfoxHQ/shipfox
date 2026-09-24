import {
  type AgentInterModuleClient,
  agentInterModuleContract,
} from '@shipfox/api-agent-dto/inter-module';
import {createInterModuleKnownError} from '@shipfox/inter-module';
import {eq} from 'drizzle-orm';
import {db, withTransaction} from '#db/db.js';
import {stepAttempts} from '#db/schema/step-attempts.js';
import {steps as stepsTable} from '#db/schema/steps.js';
import {getSessionClaimHolderStatus} from '#db/workflow-runs/steps.js';
import {
  createWorkflowRun,
  getJobsByWorkflowRunId,
  getStepAttempts,
  getStepsByJobId,
  getWorkflowContextForJob,
} from '#db/workflow-runs.js';
import {agentTestClient, resolveTestAgentDefaults} from '#test/fixtures/agent-inter-module.js';
import {stripSetupStep} from '#test/fixtures/strip-setup-step.js';
import {workflowModel} from '#test/index.js';
import {nextStepForJob, recordStepResult} from './job-execution.js';
import {claimSessionWithReconciliation} from './session-claim.js';

async function arrange() {
  const run = await createWorkflowRun({
    workspaceId: crypto.randomUUID(),
    projectId: crypto.randomUUID(),
    definitionId: crypto.randomUUID(),
    model: workflowModel({
      name: 'Session recovery',
      jobs: {
        build: {
          steps: [
            {prompt: 'Plan', session: 'main'},
            {prompt: 'Implement', session: 'main'},
          ],
        },
      },
    }),
    triggerPayload: {
      source: 'manual',
      event: 'fire',
      subscriptionId: crypto.randomUUID(),
      userId: crypto.randomUUID(),
    },
    resolveAgentDefaults: resolveTestAgentDefaults,
  });
  const [job] = await getJobsByWorkflowRunId(run.id);
  if (!job) throw new Error('Missing job');
  await stripSetupStep(job.id);
  const [first, second] = await getStepsByJobId(job.id);
  if (!first || !second) throw new Error('Missing steps');
  const sessionId = crypto.randomUUID();
  let holderId: string | null = null;
  const claimSession = vi.fn<AgentInterModuleClient['claimSession']>((input) => {
    if (holderId !== null && holderId !== input.stepAttemptId) {
      return Promise.reject(
        createInterModuleKnownError(agentInterModuleContract.methods.claimSession, 'session-held', {
          holder: {sessionId, stepAttemptId: holderId},
        }),
      );
    }
    holderId = input.stepAttemptId;
    return Promise.resolve({
      descriptor: {id: sessionId, key: 'main', mode: 'resume', segment: 0},
      harness: 'pi',
    });
  });
  const releaseSession = vi.fn<AgentInterModuleClient['releaseSession']>((input) => {
    const released = holderId === input.stepAttemptId;
    if (released) holderId = null;
    return Promise.resolve({released});
  });
  const agent = {...agentTestClient, claimSession, releaseSession};
  await nextStepForJob(job.id, agent);
  const [holder] = await getStepAttempts(job.id);
  if (!holder) throw new Error('Missing attempt');
  const context = await withTransaction((tx) => getWorkflowContextForJob(job.id, tx));
  const input = {
    ...context,
    key: 'main',
    harness: 'pi' as const,
    mode: 'resume' as const,
    stepAttemptId: crypto.randomUUID(),
    agent,
  };
  const finish = () =>
    recordStepResult({jobExecutionId: first.jobExecutionId, stepId: first.id, status: 'succeeded'});
  return {job, first, second, holder, agent, input, finish, sessionId, getHolder: () => holderId};
}

describe('session claim reconciliation', () => {
  test('advances adjacent resume steps while termination delivery is withheld', async () => {
    const ctx = await arrange();
    await ctx.finish();

    const next = await nextStepForJob(ctx.job.id, ctx.agent);

    expect(next).toMatchObject({kind: 'step', step: {id: ctx.second.id}});
    expect(ctx.agent.releaseSession).toHaveBeenCalledWith({
      sessionId: ctx.sessionId,
      stepAttemptId: ctx.holder.id,
    });
    expect(ctx.getHolder()).not.toBe(ctx.holder.id);
    const newerHolder = ctx.getHolder();
    await ctx.agent.releaseSession({sessionId: ctx.sessionId, stepAttemptId: ctx.holder.id});
    expect(ctx.getHolder()).toBe(newerHolder);
  });

  test('rejects a running holder immediately without releasing it', async () => {
    const ctx = await arrange();
    ctx.agent.claimSession.mockClear();

    await expect(claimSessionWithReconciliation(ctx.input)).rejects.toMatchObject({
      reason: 'agent_session_held',
      message: 'Agent session is held by another running attempt',
    });

    expect(ctx.agent.claimSession).toHaveBeenCalledTimes(1);
    expect(ctx.agent.releaseSession).not.toHaveBeenCalled();
  });

  test.each([
    'workspaceId',
    'projectId',
    'workflowRunAttemptId',
  ] as const)('does not recover across %s', async (field) => {
    const ctx = await arrange();
    await ctx.finish();

    await expect(
      claimSessionWithReconciliation({...ctx.input, [field]: crypto.randomUUID()}),
    ).rejects.toMatchObject({code: 'session-held'});

    expect(ctx.agent.releaseSession).not.toHaveBeenCalled();
  });

  test('does not recover an unknown holder', async () => {
    const ctx = await arrange();
    ctx.agent.claimSession.mockRejectedValue(
      createInterModuleKnownError(agentInterModuleContract.methods.claimSession, 'session-held', {
        holder: {sessionId: ctx.sessionId, stepAttemptId: crypto.randomUUID()},
      }),
    );

    await expect(claimSessionWithReconciliation(ctx.input)).rejects.toMatchObject({
      code: 'session-held',
    });

    expect(ctx.agent.releaseSession).not.toHaveBeenCalled();
  });

  test.each([
    false,
    true,
  ])('recovers after a failed release request (committed: %s)', async (committed) => {
    const ctx = await arrange();
    await ctx.finish();
    const release = ctx.agent.releaseSession.getMockImplementation();
    ctx.agent.releaseSession.mockImplementationOnce(async (input) => {
      if (committed) await release?.(input);
      throw new Error('release response unavailable');
    });

    await expect(nextStepForJob(ctx.job.id, ctx.agent)).rejects.toThrow(
      'release response unavailable',
    );
    const prepared = (await getStepAttempts(ctx.job.id)).find(
      (attempt) => attempt.stepId === ctx.second.id,
    );
    const next = await nextStepForJob(ctx.job.id, ctx.agent);

    expect(prepared?.status).toBe('running');
    expect(next).toMatchObject({kind: 'step', step: {id: ctx.second.id}});
    expect(ctx.getHolder()).toBe(prepared?.id);
  });

  test('retries acquisition when background cleanup already released the holder', async () => {
    const ctx = await arrange();
    await ctx.finish();
    const release = ctx.agent.releaseSession.getMockImplementation();
    ctx.agent.releaseSession.mockImplementationOnce(async (input) => {
      await release?.(input);
      return {released: false};
    });

    const next = await nextStepForJob(ctx.job.id, ctx.agent);

    expect(next).toMatchObject({kind: 'step', step: {id: ctx.second.id}});
  });

  test('bounds repeated terminal-holder contention and resumes on the next pull', async () => {
    const ctx = await arrange();
    await ctx.finish();
    ctx.agent.releaseSession.mockResolvedValueOnce({released: false});

    const waiting = await nextStepForJob(ctx.job.id, ctx.agent);
    const next = await nextStepForJob(ctx.job.id, ctx.agent);

    expect(waiting).toEqual({kind: 'wait', retryAfterMs: 1000});
    expect(next).toMatchObject({kind: 'step', step: {id: ctx.second.id}});
    expect(ctx.agent.releaseSession).toHaveBeenCalledTimes(2);
  });

  test('waits when recovery encounters a locked registry', async () => {
    const ctx = await arrange();
    await ctx.finish();
    const release = ctx.agent.releaseSession.getMockImplementation();
    ctx.agent.releaseSession.mockImplementationOnce(async (input) => {
      await release?.(input);
      ctx.agent.claimSession.mockRejectedValueOnce(
        createInterModuleKnownError(
          agentInterModuleContract.methods.claimSession,
          'session-lock-unavailable',
          {},
        ),
      );
      return {released: true};
    });

    const waiting = await nextStepForJob(ctx.job.id, ctx.agent);
    const next = await nextStepForJob(ctx.job.id, ctx.agent);

    expect(waiting.kind).toBe('wait');
    expect(next.kind).toBe('step');
  });

  test('uses the terminal attempt even after its step has restarted', async () => {
    const ctx = await arrange();
    await ctx.finish();
    await db()
      .update(stepsTable)
      .set({status: 'pending', currentAttempt: 2})
      .where(eq(stepsTable.id, ctx.first.id));

    const status = await getSessionClaimHolderStatus({...ctx.input, stepAttemptId: ctx.holder.id});
    const result = await claimSessionWithReconciliation(ctx.input);

    expect(status).toBe('succeeded');
    expect(result?.descriptor?.id).toBe(ctx.sessionId);
  });

  test('does not release a new live holder after a recovery race', async () => {
    const ctx = await arrange();
    await ctx.finish();
    ctx.agent.releaseSession.mockImplementationOnce(async () => {
      const contenderId = crypto.randomUUID();
      await db().insert(stepAttempts).values({
        id: contenderId,
        stepId: ctx.first.id,
        jobExecutionId: ctx.first.jobExecutionId,
        attempt: 2,
        executionOrder: 3,
        status: 'running',
      });
      ctx.agent.claimSession.mockImplementation(() => {
        return Promise.reject(
          createInterModuleKnownError(
            agentInterModuleContract.methods.claimSession,
            'session-held',
            {
              holder: {sessionId: ctx.sessionId, stepAttemptId: contenderId},
            },
          ),
        );
      });
      return {released: false};
    });

    const next = await nextStepForJob(ctx.job.id, ctx.agent);

    expect(next).toEqual({kind: 'done', status: 'failed'});
    expect(ctx.agent.releaseSession).toHaveBeenCalledTimes(1);
  });
});

test('recovers a claim acquired before its response was lost', async () => {
  const ctx = await arrange();
  await ctx.finish();
  const claim = ctx.agent.claimSession.getMockImplementation();
  const release = ctx.agent.releaseSession.getMockImplementation();
  ctx.agent.releaseSession.mockImplementationOnce(async (input) => {
    const result = await release?.(input);
    ctx.agent.claimSession.mockImplementationOnce(async (input) => {
      await claim?.(input);
      throw new Error('claim response lost');
    });
    return result ?? {released: false};
  });

  await expect(nextStepForJob(ctx.job.id, ctx.agent)).rejects.toThrow('claim response lost');
  const holder = ctx.getHolder();
  const next = await nextStepForJob(ctx.job.id, ctx.agent);

  expect(next).toMatchObject({kind: 'step', step: {id: ctx.second.id}});
  expect(ctx.getHolder()).toBe(holder);
  expect(
    (await getStepAttempts(ctx.job.id)).filter((attempt) => attempt.stepId === ctx.second.id),
  ).toHaveLength(1);
});

test('does not dispatch a step canceled during recovery', async () => {
  const ctx = await arrange();
  await ctx.finish();
  const release = ctx.agent.releaseSession.getMockImplementation();
  ctx.agent.releaseSession.mockImplementationOnce(async (input) => {
    const result = await release?.(input);
    await db()
      .update(stepsTable)
      .set({status: 'cancelled'})
      .where(eq(stepsTable.id, ctx.second.id));
    await db()
      .update(stepAttempts)
      .set({status: 'cancelled', finishedAt: new Date()})
      .where(eq(stepAttempts.stepId, ctx.second.id));
    return result ?? {released: false};
  });

  const next = await nextStepForJob(ctx.job.id, ctx.agent);

  expect(next.kind).toBe('done');
  expect(ctx.getHolder()).toBeNull();
});

test('waits for contention from the requesting attempt itself without releasing it', async () => {
  const ctx = await arrange();
  ctx.agent.claimSession.mockRejectedValueOnce(
    createInterModuleKnownError(agentInterModuleContract.methods.claimSession, 'session-held', {
      holder: {sessionId: ctx.sessionId, stepAttemptId: ctx.input.stepAttemptId},
    }),
  );

  const result = await claimSessionWithReconciliation(ctx.input);

  expect(result).toBeNull();
  expect(ctx.agent.releaseSession).not.toHaveBeenCalled();
});

test.each(['failed', 'cancelled'] as const)('recovers a %s holder', async (status) => {
  const ctx = await arrange();
  await db()
    .update(stepAttempts)
    .set({status, finishedAt: new Date()})
    .where(eq(stepAttempts.id, ctx.holder.id));

  const result = await claimSessionWithReconciliation(ctx.input);

  expect(result?.descriptor?.id).toBe(ctx.sessionId);
  expect(ctx.getHolder()).toBe(ctx.input.stepAttemptId);
});
