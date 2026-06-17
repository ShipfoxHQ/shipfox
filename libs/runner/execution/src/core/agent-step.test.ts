import type {StepDto} from '@shipfox/api-workflows-dto';
import type {AgentHarness, AgentInvocation} from '#core/agent-harness.js';
import {executeAgentStep} from '#core/agent-step.js';

function buildAgentStep(overrides: Partial<StepDto> = {}): StepDto {
  return {
    id: '00000000-0000-0000-0000-000000000001',
    job_id: '00000000-0000-0000-0000-000000000002',
    name: 'implement',
    status: 'running',
    type: 'agent',
    config: {model: 'claude-opus-4-8', thinking: 'high', prompt: 'Fix the failing tests.'},
    error: null,
    position: 1,
    current_attempt: 1,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function fakeHarness(run: AgentHarness['run']): AgentHarness {
  return {run};
}

describe('executeAgentStep', () => {
  it('runs the harness and reports process-success with exit_code 0', async () => {
    const calls: AgentInvocation[] = [];
    const harness = fakeHarness((invocation) => {
      calls.push(invocation);
      return Promise.resolve({summary: 'done'});
    });

    const result = await executeAgentStep(buildAgentStep(), {cwd: '/work', harness});

    expect(result).toEqual({success: true, output: 'done', error: null, exit_code: 0});
    expect(calls[0]).toMatchObject({
      cwd: '/work',
      model: 'claude-opus-4-8',
      thinking: 'high',
      prompt: 'Fix the failing tests.',
    });
  });

  it('defaults thinking to high when the config omits it', async () => {
    const calls: AgentInvocation[] = [];
    const harness = fakeHarness((invocation) => {
      calls.push(invocation);
      return Promise.resolve({});
    });

    await executeAgentStep(buildAgentStep({config: {model: 'm', prompt: 'p'}}), {harness});

    expect(calls[0]?.thinking).toBe('high');
  });

  it('fails with agent_invocation_failed when the harness throws', async () => {
    const harness = fakeHarness(() => Promise.reject(new Error('model not found')));

    const result = await executeAgentStep(buildAgentStep(), {harness});

    expect(result.success).toBe(false);
    expect(result.error).toEqual({message: 'model not found', reason: 'agent_invocation_failed'});
    expect(result.exit_code).toBeNull();
  });

  it('rejects a non-agent step type without invoking the harness', async () => {
    const harness = fakeHarness(() => Promise.reject(new Error('should not run')));

    const result = await executeAgentStep(buildAgentStep({type: 'run', config: {run: 'x'}}), {
      harness,
    });

    expect(result.success).toBe(false);
    expect(result.error?.message).toContain('Unsupported step type');
  });

  it('fails when the config is missing model or prompt', async () => {
    const harness = fakeHarness(() => Promise.reject(new Error('should not run')));

    const result = await executeAgentStep(buildAgentStep({config: {model: 'm'}}), {harness});

    expect(result.success).toBe(false);
    expect(result.error?.reason).toBe('agent_invocation_failed');
  });

  it('returns promptly when the signal aborts even if the harness never resolves', async () => {
    const ac = new AbortController();
    let sawSignal: AbortSignal | undefined;
    const harness = fakeHarness((invocation) => {
      sawSignal = invocation.signal;
      // Never settles, proving executeAgentStep returns via the abort race, not the harness.
      return new Promise<never>(() => {
        // intentionally pending forever
      });
    });

    const promise = executeAgentStep(buildAgentStep(), {harness, signal: ac.signal});
    ac.abort();
    const result = await promise;

    expect(result.success).toBe(false);
    expect(sawSignal).toBe(ac.signal);
  });
});
