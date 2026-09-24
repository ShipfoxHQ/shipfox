import crypto from 'node:crypto';
import {agentInterModuleContract} from '@shipfox/api-agent-dto/inter-module';
import {isInterModuleKnownError} from '@shipfox/inter-module';
import {AgentSessionHeldError, AgentSessionLockUnavailableError} from '#core/errors.js';
import {agentTestSecretsClient} from '#test/fixtures/secrets-client.js';

const claimStepSessionMock = vi.hoisted(() => vi.fn());

vi.mock('#core/claim-step-session.js', () => ({
  claimStepSession: claimStepSessionMock,
}));

const {createAgentInterModulePresentation} = await import('./inter-module.js');

const signal = new AbortController().signal;

function newClaimInput() {
  return {
    workspaceId: crypto.randomUUID(),
    projectId: crypto.randomUUID(),
    workflowRunAttemptId: crypto.randomUUID(),
    key: 'main',
    harness: 'pi' as const,
    stepAttemptId: crypto.randomUUID(),
    mode: 'resume' as const,
  };
}

describe('agent inter-module claimSession error mapping', () => {
  beforeEach(() => {
    claimStepSessionMock.mockReset();
  });

  it('maps a lock-contention failure to the session-lock-unavailable contract code', async () => {
    claimStepSessionMock.mockRejectedValue(
      new AgentSessionLockUnavailableError({
        sessionId: crypto.randomUUID(),
        workflowRunAttemptId: crypto.randomUUID(),
        key: 'main',
      }),
    );
    const presentation = createAgentInterModulePresentation({
      secrets: agentTestSecretsClient,
      workspaceProviders: 'enabled',
    });

    const result = await Promise.resolve(
      presentation.handlers.claimSession(newClaimInput(), {signal}),
    ).catch((error: unknown) => error);

    expect(isInterModuleKnownError(agentInterModuleContract.methods.claimSession, result)).toBe(
      true,
    );
    if (!isInterModuleKnownError(agentInterModuleContract.methods.claimSession, result)) {
      throw new Error('Expected a claim known error');
    }
    expect(result.code).toBe('session-lock-unavailable');
  });

  it('lets an unexpected failure through unmapped', async () => {
    claimStepSessionMock.mockRejectedValue(new Error('unexpected'));
    const presentation = createAgentInterModulePresentation({
      secrets: agentTestSecretsClient,
      workspaceProviders: 'enabled',
    });

    const result = await Promise.resolve(
      presentation.handlers.claimSession(newClaimInput(), {signal}),
    ).catch((error: unknown) => error);

    expect(result).toBeInstanceOf(Error);
    expect(isInterModuleKnownError(agentInterModuleContract.methods.claimSession, result)).toBe(
      false,
    );
  });
});

test.each([
  false,
  true,
])('maps holder context without leaking a mismatched scope (%s)', async (scopeMismatch) => {
  const holder = {sessionId: crypto.randomUUID(), stepAttemptId: crypto.randomUUID()};
  claimStepSessionMock.mockRejectedValue(
    new AgentSessionHeldError({
      sessionId: holder.sessionId,
      heldByStepAttempt: holder.stepAttemptId,
      workflowRunAttemptId: crypto.randomUUID(),
      key: 'main',
      scopeMismatch,
    }),
  );
  const presentation = createAgentInterModulePresentation({
    secrets: agentTestSecretsClient,
    workspaceProviders: 'enabled',
  });

  const error = await Promise.resolve(
    presentation.handlers.claimSession(newClaimInput(), {signal}),
  ).catch((error: unknown) => error);

  expect(error).toMatchObject({code: 'session-held', details: scopeMismatch ? {} : {holder}});
  if (scopeMismatch) expect(error).not.toHaveProperty('details.holder');
});
