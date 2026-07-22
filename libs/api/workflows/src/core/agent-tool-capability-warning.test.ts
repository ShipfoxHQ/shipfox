import type {AnnotationsInterModuleClient} from '@shipfox/annotations-dto/inter-module';
import type {JobLeaseTokenClaims} from '@shipfox/api-auth-dto';
import {sql} from 'drizzle-orm';
import {db} from '#db/db.js';
import {runnersTestClient} from '#test/fixtures/runners-inter-module.js';
import {warnAgentToolCapabilityMismatchOnDispatch as warnAgentToolCapabilityMismatchOnDispatchImpl} from './agent-tool-capability-warning.js';
import type {Step} from './entities/step.js';

async function warnAgentToolCapabilityMismatchOnDispatch(
  params: Omit<
    Parameters<typeof warnAgentToolCapabilityMismatchOnDispatchImpl>[0],
    'annotations' | 'runners'
  >,
) {
  return await warnAgentToolCapabilityMismatchOnDispatchImpl({
    annotations: annotationsTestClient,
    runners: runnersTestClient,
    ...params,
  });
}

const annotationBodiesByExecution = new Map<string, Map<string, string>>();

const annotationsTestClient: AnnotationsInterModuleClient = {
  replaceOrRemoveAnnotation(input) {
    const annotations = annotationBodiesByExecution.get(input.jobExecutionId) ?? new Map();
    annotationBodiesByExecution.set(input.jobExecutionId, annotations);
    if (input.annotation.op === 'remove') {
      annotations.delete(input.context);
    } else {
      annotations.set(input.context, input.annotation.body);
    }
    return Promise.resolve({});
  },
};

function lease(params: Partial<JobLeaseTokenClaims> = {}): JobLeaseTokenClaims {
  const now = Math.floor(Date.now() / 1000);
  return {
    aud: 'runner-job-lease',
    iat: now,
    exp: now + 60,
    workspaceId: crypto.randomUUID(),
    projectId: crypto.randomUUID(),
    workflowRunId: crypto.randomUUID(),
    workflowRunAttempt: 1,
    workflowRunAttemptId: crypto.randomUUID(),
    jobId: crypto.randomUUID(),
    jobExecutionId: crypto.randomUUID(),
    runnerSessionId: crypto.randomUUID(),
    currentStepId: crypto.randomUUID(),
    currentStepAttempt: 1,
    ...params,
  };
}

function agentStep(params: Partial<Step> = {}): Step {
  return {
    id: crypto.randomUUID(),
    jobExecutionId: crypto.randomUUID(),
    key: 'fix',
    name: 'Fix',
    sourceLocation: null,
    status: 'running',
    statusReason: null,
    evaluationTrace: null,
    type: 'agent',
    config: {
      harness: 'pi',
      provider: 'anthropic',
      model: 'claude-opus-4-8',
      thinking: 'high',
      tools: ['read', 'web_search'],
      prompt: 'Fix it.',
    },
    condition: null,
    configPlan: null,
    authoredConfig: null,
    error: null,
    position: 0,
    version: 1,
    currentAttempt: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...params,
  };
}

async function insertRunnerSession(params: {
  runnerSessionId: string;
  workspaceId: string;
  toolCapabilities: Record<string, unknown> | null;
  reportedAt?: 'fresh' | 'stale' | 'missing';
}): Promise<void> {
  const reportedAt =
    params.reportedAt === 'missing'
      ? sql`NULL`
      : params.reportedAt === 'stale'
        ? sql`now() - interval '1 hour'`
        : sql`now()`;
  const toolCapabilities =
    params.toolCapabilities === null
      ? sql`NULL`
      : sql`${JSON.stringify(params.toolCapabilities)}::jsonb`;

  await db().execute(sql`
    INSERT INTO runners_runner_sessions (
      id,
      workspace_id,
      scope,
      registration_token_id,
      registration_token_kind,
      labels,
      tool_capabilities,
      tool_capabilities_reported_at
    )
    VALUES (
      ${params.runnerSessionId},
      ${params.workspaceId},
      'workspace',
      ${crypto.randomUUID()},
      'manual',
      ARRAY['linux'],
      ${toolCapabilities},
      ${reportedAt}
    )
  `);
}

function annotationsFor(jobExecutionId: string): Array<{context: string; body: string}> {
  return Array.from(annotationBodiesByExecution.get(jobExecutionId) ?? [], ([context, body]) => ({
    context,
    body,
  }));
}

describe('warnAgentToolCapabilityMismatchOnDispatch', () => {
  it('writes a warning when the matched runner advertised a set without requested tools', async () => {
    const identity = lease();
    const step = agentStep({jobExecutionId: identity.jobExecutionId});
    await insertRunnerSession({
      runnerSessionId: identity.runnerSessionId,
      workspaceId: identity.workspaceId,
      toolCapabilities: {harnesses: {pi: {tools: ['read']}}},
    });

    await warnAgentToolCapabilityMismatchOnDispatch({leaseIdentity: identity, step});

    const rows = await annotationsFor(identity.jobExecutionId);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.context).toBe(`agent-tool-capability:${step.id}`);
    expect(rows[0]?.body).toContain('advertised a `pi` tool set without: `web_search`');
    expect(rows[0]?.body).toContain('Execution is continuing');
  });

  it('writes unknown wording when capabilities are missing', async () => {
    const identity = lease();
    const step = agentStep({jobExecutionId: identity.jobExecutionId});
    await insertRunnerSession({
      runnerSessionId: identity.runnerSessionId,
      workspaceId: identity.workspaceId,
      toolCapabilities: null,
      reportedAt: 'missing',
    });

    await warnAgentToolCapabilityMismatchOnDispatch({leaseIdentity: identity, step});

    const rows = await annotationsFor(identity.jobExecutionId);
    expect(rows[0]?.body).toContain('reported no or stale tool capabilities');
    expect(rows[0]?.body).toContain('`read`, `web_search`');
  });

  it('writes missing-harness wording when fresh capabilities omit the harness', async () => {
    const identity = lease();
    const step = agentStep({jobExecutionId: identity.jobExecutionId});
    await insertRunnerSession({
      runnerSessionId: identity.runnerSessionId,
      workspaceId: identity.workspaceId,
      toolCapabilities: {harnesses: {claude: {tools: ['read', 'web_search']}}},
    });

    await warnAgentToolCapabilityMismatchOnDispatch({leaseIdentity: identity, step});

    const rows = await annotationsFor(identity.jobExecutionId);
    expect(rows[0]?.body).toContain('did not advertise a `pi` tool set');
    expect(rows[0]?.body).not.toContain('reported no or stale tool capabilities');
  });

  it('uses Markdown-safe code spans for requested tool names', async () => {
    const identity = lease();
    const step = agentStep({
      jobExecutionId: identity.jobExecutionId,
      config: {
        harness: 'pi',
        provider: 'anthropic',
        model: 'claude-opus-4-8',
        thinking: 'high',
        tools: ['read', 'we`ird'],
        prompt: 'Fix it.',
      },
    });
    await insertRunnerSession({
      runnerSessionId: identity.runnerSessionId,
      workspaceId: identity.workspaceId,
      toolCapabilities: {harnesses: {pi: {tools: ['read']}}},
    });

    await warnAgentToolCapabilityMismatchOnDispatch({leaseIdentity: identity, step});

    const rows = await annotationsFor(identity.jobExecutionId);
    expect(rows[0]?.body).toContain('``we`ird``');
  });

  it('removes an existing warning when a later dispatch has all requested tools', async () => {
    const identity = lease();
    const step = agentStep({jobExecutionId: identity.jobExecutionId});
    await insertRunnerSession({
      runnerSessionId: identity.runnerSessionId,
      workspaceId: identity.workspaceId,
      toolCapabilities: {harnesses: {pi: {tools: ['read']}}},
    });
    await warnAgentToolCapabilityMismatchOnDispatch({leaseIdentity: identity, step});
    await db().execute(sql`
      UPDATE runners_runner_sessions
      SET tool_capabilities = ${JSON.stringify({
        harnesses: {pi: {tools: ['read', 'web_search']}},
      })}::jsonb,
      tool_capabilities_reported_at = now()
      WHERE id = ${identity.runnerSessionId}
    `);

    await warnAgentToolCapabilityMismatchOnDispatch({leaseIdentity: identity, step});

    const rows = await annotationsFor(identity.jobExecutionId);
    expect(rows).toEqual([]);
  });

  it('does nothing for agent steps without requested tools', async () => {
    const identity = lease();
    const step = agentStep({
      jobExecutionId: identity.jobExecutionId,
      config: {
        harness: 'pi',
        provider: 'anthropic',
        model: 'claude-opus-4-8',
        thinking: 'high',
        prompt: 'Fix it.',
      },
    });
    await insertRunnerSession({
      runnerSessionId: identity.runnerSessionId,
      workspaceId: identity.workspaceId,
      toolCapabilities: null,
    });

    await warnAgentToolCapabilityMismatchOnDispatch({leaseIdentity: identity, step});

    expect(await annotationsFor(identity.jobExecutionId)).toEqual([]);
  });

  it('does nothing for non-agent steps', async () => {
    const identity = lease();
    const step = agentStep({
      jobExecutionId: identity.jobExecutionId,
      type: 'run',
      config: {run: 'echo ok'},
    });
    await insertRunnerSession({
      runnerSessionId: identity.runnerSessionId,
      workspaceId: identity.workspaceId,
      toolCapabilities: null,
    });

    await warnAgentToolCapabilityMismatchOnDispatch({leaseIdentity: identity, step});

    expect(await annotationsFor(identity.jobExecutionId)).toEqual([]);
  });

  it('caps long tool lists in the warning body', async () => {
    const identity = lease();
    const tools = Array.from({length: 12}, (_, index) => `tool_${index}`);
    const step = agentStep({
      jobExecutionId: identity.jobExecutionId,
      config: {
        harness: 'pi',
        provider: 'anthropic',
        model: 'claude-opus-4-8',
        thinking: 'high',
        tools,
        prompt: 'Fix it.',
      },
    });
    await insertRunnerSession({
      runnerSessionId: identity.runnerSessionId,
      workspaceId: identity.workspaceId,
      toolCapabilities: {harnesses: {pi: {tools: []}}},
    });

    await warnAgentToolCapabilityMismatchOnDispatch({leaseIdentity: identity, step});

    const rows = await annotationsFor(identity.jobExecutionId);
    expect(rows[0]?.body).toContain('...and 2 more');
    expect(rows[0]?.body).not.toContain('tool_10');
  });
});
