const {runAgentMock} = vi.hoisted(() => ({runAgentMock: vi.fn()}));

vi.mock('#core/run-agent.js', () => ({runAgent: runAgentMock}));

import type {StepDto} from '@shipfox/api-workflows-dto';
import type {AgentInvocation} from '#core/run-agent.js';
import {executeAgentStep} from '#core/step.js';

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

describe('executeAgentStep', () => {
  beforeEach(() => {
    runAgentMock.mockReset();
  });

  it('runs the agent and reports process-success with exit_code 0', async () => {
    runAgentMock.mockResolvedValue({summary: 'done'});

    const result = await executeAgentStep(buildAgentStep(), {cwd: '/work'});

    expect(result).toEqual({success: true, output: 'done', error: null, exit_code: 0});
    expect(runAgentMock).toHaveBeenCalledWith(
      expect.objectContaining({
        cwd: '/work',
        model: 'claude-opus-4-8',
        thinking: 'high',
        prompt: 'Fix the failing tests.',
      }),
    );
  });

  it('defaults thinking to high when the config omits it', async () => {
    runAgentMock.mockResolvedValue({});

    await executeAgentStep(buildAgentStep({config: {model: 'm', prompt: 'p'}}), {});

    expect(runAgentMock).toHaveBeenCalledWith(expect.objectContaining({thinking: 'high'}));
  });

  it('fails with agent_invocation_failed when the agent run throws', async () => {
    runAgentMock.mockRejectedValue(new Error('model not found'));

    const result = await executeAgentStep(buildAgentStep(), {});

    expect(result.success).toBe(false);
    expect(result.error).toEqual({message: 'model not found', reason: 'agent_invocation_failed'});
    expect(result.exit_code).toBeNull();
  });

  it('rejects a non-agent step type without running the agent', async () => {
    const result = await executeAgentStep(buildAgentStep({type: 'run', config: {run: 'x'}}), {});

    expect(result.success).toBe(false);
    expect(result.error?.message).toContain('Unsupported step type');
    expect(runAgentMock).not.toHaveBeenCalled();
  });

  it('fails when the config is missing model or prompt', async () => {
    const result = await executeAgentStep(buildAgentStep({config: {model: 'm'}}), {});

    expect(result.success).toBe(false);
    expect(result.error?.reason).toBe('agent_invocation_failed');
    expect(runAgentMock).not.toHaveBeenCalled();
  });

  it('returns promptly when the signal aborts even if the agent run never resolves', async () => {
    const ac = new AbortController();
    let sawSignal: AbortSignal | undefined;
    runAgentMock.mockImplementation((invocation: AgentInvocation) => {
      sawSignal = invocation.signal;
      // Never settles, proving executeAgentStep returns via the abort race, not the run.
      return new Promise<never>(() => {
        // intentionally pending forever
      });
    });

    const promise = executeAgentStep(buildAgentStep(), {signal: ac.signal});
    ac.abort();
    const result = await promise;

    expect(result.success).toBe(false);
    expect(sawSignal).toBe(ac.signal);
  });

  it('fails without crashing when the signal is already aborted before the call', async () => {
    const ac = new AbortController();
    ac.abort();
    runAgentMock.mockRejectedValue(new Error('agent rejected after abort'));

    const result = await executeAgentStep(buildAgentStep(), {signal: ac.signal});

    expect(result.success).toBe(false);
  });
});
