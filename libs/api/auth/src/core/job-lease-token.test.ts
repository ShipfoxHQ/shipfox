import {JOB_LEASE_TOKEN_AUDIENCE} from '@shipfox/api-auth-dto';
import {jobLeaseTokenKey} from '@shipfox/node-auth-root-key';
import {signHs256} from '@shipfox/node-jwt';
import {issueJobLeaseToken, renewStepLeaseTokens, verifyJobLeaseToken} from './job-lease-token.js';

// Matches test/env.ts; the codec reads this same value from config.
const SECRET = jobLeaseTokenKey();

function claims() {
  return {
    workflowRunId: crypto.randomUUID(),
    workflowRunAttemptId: crypto.randomUUID(),
    jobId: crypto.randomUUID(),
    jobExecutionId: crypto.randomUUID(),
    projectId: crypto.randomUUID(),
    workspaceId: crypto.randomUUID(),
    runnerSessionId: crypto.randomUUID(),
  };
}

describe('job-lease-token', () => {
  test('issues a token that verifies round-trip', async () => {
    const input = claims();

    const token = await issueJobLeaseToken(input);
    const verified = await verifyJobLeaseToken(token);

    expect(verified).not.toBeNull();
    expect(verified?.workflowRunId).toBe(input.workflowRunId);
    expect(verified?.workflowRunAttemptId).toBe(input.workflowRunAttemptId);
    expect(verified?.jobId).toBe(input.jobId);
    expect(verified?.projectId).toBe(input.projectId);
    expect(verified?.workspaceId).toBe(input.workspaceId);
    expect(verified?.runnerSessionId).toBe(input.runnerSessionId);
    expect(verified?.aud).toBe(JOB_LEASE_TOKEN_AUDIENCE);
    expect(verified?.iat).toBeTypeOf('number');
    expect(verified?.exp).toBeGreaterThan(verified?.iat ?? 0);
  });

  test('omits step scope when issuing a job-scoped token', async () => {
    const input = claims();

    const token = await issueJobLeaseToken(input);
    const verified = await verifyJobLeaseToken(token);

    expect(verified?.currentStepId).toBeUndefined();
    expect(verified?.currentStepAttempt).toBeUndefined();
  });

  test('round-trips the current step scope when present', async () => {
    const input = {
      ...claims(),
      currentStepId: crypto.randomUUID(),
      currentStepAttempt: 2,
    };

    const token = await issueJobLeaseToken(input);
    const verified = await verifyJobLeaseToken(token);

    expect(verified?.currentStepId).toBe(input.currentStepId);
    expect(verified?.currentStepAttempt).toBe(input.currentStepAttempt);
  });

  test('returns claims when metric recording fails after successful verification', async () => {
    vi.resetModules();
    vi.doMock('@shipfox/node-opentelemetry', () => ({
      instanceMetrics: {
        getMeter: () => ({
          createCounter: () => ({
            add: () => {
              throw new Error('metrics unavailable');
            },
          }),
          createHistogram: () => ({record: () => undefined}),
        }),
      },
    }));

    try {
      const tokenModule = await import('./job-lease-token.js');
      const input = claims();

      const token = await tokenModule.issueJobLeaseToken(input);
      const verified = await tokenModule.verifyJobLeaseToken(token);

      expect(verified?.jobId).toBe(input.jobId);
    } finally {
      vi.doUnmock('@shipfox/node-opentelemetry');
      vi.resetModules();
    }
  });

  test('accepts UUIDv7 ids (job/run primary keys are uuidv7)', async () => {
    const input = {
      workflowRunId: '018f6b1e-7e2a-7b3c-8d4e-5f6a7b8c9d0d',
      workflowRunAttemptId: '018f6b1e-7e2a-7b3c-8d4e-5f6a7b8c9d0f',
      jobId: '018f6b1e-7e2a-7b3c-8d4e-5f6a7b8c9d0e',
      jobExecutionId: '018f6b1e-7e2a-7b3c-8d4e-5f6a7b8c9d10',
      projectId: crypto.randomUUID(),
      workspaceId: crypto.randomUUID(),
      runnerSessionId: crypto.randomUUID(),
    };

    const token = await issueJobLeaseToken(input);
    const verified = await verifyJobLeaseToken(token);

    expect(verified?.workflowRunId).toBe(input.workflowRunId);
    expect(verified?.workflowRunAttemptId).toBe(input.workflowRunAttemptId);
    expect(verified?.jobId).toBe(input.jobId);
  });

  test('returns null for a tampered token', async () => {
    const token = await issueJobLeaseToken(claims());
    const tampered = `${token.slice(0, -4)}xxxx`;

    const verified = await verifyJobLeaseToken(tampered);

    expect(verified).toBeNull();
  });

  test('returns null for a token signed with a different secret', async () => {
    const token = await signHs256({
      payload: claims(),
      secret: 'a-different-secret',
      expiresIn: '90m',
      audience: JOB_LEASE_TOKEN_AUDIENCE,
    });

    const verified = await verifyJobLeaseToken(token);

    expect(verified).toBeNull();
  });

  test('returns null for an expired token', async () => {
    const token = await signHs256({
      payload: claims(),
      secret: SECRET,
      expiresIn: '-1s',
      audience: JOB_LEASE_TOKEN_AUDIENCE,
    });

    const verified = await verifyJobLeaseToken(token);

    expect(verified).toBeNull();
  });

  test.each(['not.a.token', '', 'a.b.c'])('returns null for invalid input %j', async (input) => {
    const verified = await verifyJobLeaseToken(input);

    expect(verified).toBeNull();
  });

  test('returns null for a token with the wrong audience', async () => {
    const token = await signHs256({
      payload: claims(),
      secret: SECRET,
      expiresIn: '90m',
      audience: 'some-other-audience',
    });

    const verified = await verifyJobLeaseToken(token);

    expect(verified).toBeNull();
  });

  test('returns null for a token with no audience claim', async () => {
    const token = await signHs256({
      payload: claims(),
      secret: SECRET,
      expiresIn: '90m',
    });

    const verified = await verifyJobLeaseToken(token);

    expect(verified).toBeNull();
  });

  test('returns null for a token whose claims fail the schema (non-uuid jobId)', async () => {
    const token = await signHs256({
      payload: {...claims(), jobId: 'not-a-uuid'},
      secret: SECRET,
      expiresIn: '90m',
      audience: JOB_LEASE_TOKEN_AUDIENCE,
    });

    const verified = await verifyJobLeaseToken(token);

    expect(verified).toBeNull();
  });

  test('returns null for a token whose claims fail the schema (non-uuid projectId)', async () => {
    const token = await signHs256({
      payload: {...claims(), projectId: 'not-a-uuid'},
      secret: SECRET,
      expiresIn: '90m',
      audience: JOB_LEASE_TOKEN_AUDIENCE,
    });

    const verified = await verifyJobLeaseToken(token);

    expect(verified).toBeNull();
  });
});

describe('renewStepLeaseTokens', () => {
  test('re-issues each step-scoped token of the lease with the same claims', async () => {
    const lease = {...claims(), workflowRunAttempt: 2};
    const first = {currentStepId: crypto.randomUUID(), currentStepAttempt: 1};
    const second = {currentStepId: crypto.randomUUID(), currentStepAttempt: 3};
    const firstToken = await issueJobLeaseToken({...lease, ...first});
    const secondToken = await issueJobLeaseToken({...lease, ...second});

    const renewed = await renewStepLeaseTokens({
      jobExecutionId: lease.jobExecutionId,
      runnerSessionId: lease.runnerSessionId,
      tokens: [firstToken, secondToken],
    });

    expect(renewed.map(({stepId, attempt}) => ({stepId, attempt}))).toEqual([
      {stepId: first.currentStepId, attempt: 1},
      {stepId: second.currentStepId, attempt: 3},
    ]);
    const verified = await verifyJobLeaseToken(renewed[1]?.token ?? '');
    expect(verified).toMatchObject({...lease, ...second});
  });

  test('drops tokens without a step scope or from another lease', async () => {
    const lease = claims();
    const jobToken = await issueJobLeaseToken(lease);
    const otherExecutionToken = await issueJobLeaseToken({
      ...lease,
      jobExecutionId: crypto.randomUUID(),
      currentStepId: crypto.randomUUID(),
      currentStepAttempt: 1,
    });
    const otherSessionToken = await issueJobLeaseToken({
      ...lease,
      runnerSessionId: crypto.randomUUID(),
      currentStepId: crypto.randomUUID(),
      currentStepAttempt: 1,
    });

    const renewed = await renewStepLeaseTokens({
      jobExecutionId: lease.jobExecutionId,
      runnerSessionId: lease.runnerSessionId,
      tokens: [jobToken, otherExecutionToken, otherSessionToken, 'not-a-token'],
    });

    expect(renewed).toEqual([]);
  });
});
