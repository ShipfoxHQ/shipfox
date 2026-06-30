const {runAgentMock} = vi.hoisted(() => ({runAgentMock: vi.fn()}));

vi.mock('#core/run-agent.js', () => ({runAgent: runAgentMock}));

import type {StepDto} from '@shipfox/api-workflows-dto';
import {AgentConfigError} from '#core/errors.js';
import type {AgentInvocation} from '#core/run-agent.js';
import {executeAgentStep} from '#core/step.js';

const RUNTIME = {
  provider: 'anthropic',
  model: 'claude-opus-4-8',
  thinking: 'high',
  credentials: {api_key: 'sk-runtime-secret'},
};

function buildAgentStep(overrides: Partial<StepDto> = {}): StepDto {
  const displayName =
    overrides.display_name ??
    (typeof overrides.name === 'string' && overrides.name.trim() ? overrides.name : 'implement');
  return {
    id: '00000000-0000-0000-0000-000000000001',
    job_execution_id: '00000000-0000-0000-0000-000000000003',
    name: 'implement',
    display_name: displayName,
    source_location: null,
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

    const result = await executeAgentStep(buildAgentStep(), {cwd: '/work', runtime: RUNTIME});

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

  it('forwards runtime provider, model, and thinking to the agent invocation', async () => {
    runAgentMock.mockResolvedValue({});

    await executeAgentStep(buildAgentStep({config: {prompt: 'p'}}), {
      runtime: {
        provider: 'openai',
        model: 'gpt-5.1',
        thinking: 'medium',
        credentials: {api_key: 'sk-openai'},
      },
    });

    expect(runAgentMock).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'openai',
        model: 'gpt-5.1',
        thinking: 'medium',
        credentials: {api_key: 'sk-openai'},
      }),
    );
  });

  it('ignores stale provider, model, and thinking values in step config', async () => {
    runAgentMock.mockResolvedValue({});

    await executeAgentStep(
      buildAgentStep({
        config: {provider: 'anthropic', model: 'claude-opus-4-8', thinking: 'high', prompt: 'p'},
      }),
      {
        runtime: {
          provider: 'openai',
          model: 'gpt-5.1',
          thinking: 'low',
          credentials: {api_key: 'sk-openai'},
        },
      },
    );

    expect(runAgentMock).toHaveBeenCalledWith(
      expect.objectContaining({provider: 'openai', model: 'gpt-5.1', thinking: 'low'}),
    );
  });

  it('fails with agent_invocation_failed when the agent run throws a generic error', async () => {
    runAgentMock.mockRejectedValue(new Error('provider returned 503'));

    const result = await executeAgentStep(buildAgentStep(), {runtime: RUNTIME});

    expect(result.success).toBe(false);
    expect(result.error).toEqual({
      message: 'provider returned 503',
      reason: 'agent_invocation_failed',
    });
    expect(result.exit_code).toBeNull();
  });

  it('fails with agent_config_invalid when the agent run throws an AgentConfigError', async () => {
    runAgentMock.mockRejectedValue(
      new AgentConfigError('Unknown provider "foo" for agent step.', 'provider_unsupported'),
    );

    const result = await executeAgentStep(buildAgentStep(), {runtime: RUNTIME});

    expect(result.success).toBe(false);
    expect(result.error).toEqual({
      message: 'Unknown provider "foo" for agent step.',
      reason: 'agent_config_invalid',
      agent_config_issue: 'provider_unsupported',
    });
  });

  it('rejects a non-agent step type without running the agent', async () => {
    const result = await executeAgentStep(buildAgentStep({type: 'run', config: {run: 'x'}}), {
      runtime: RUNTIME,
    });

    expect(result.success).toBe(false);
    expect(result.error?.message).toContain('Unsupported step type');
    expect(runAgentMock).not.toHaveBeenCalled();
  });

  it('fails with agent_config_invalid when the config is missing prompt', async () => {
    const result = await executeAgentStep(buildAgentStep({config: {model: 'm'}}), {
      runtime: RUNTIME,
    });

    expect(result.success).toBe(false);
    expect(result.error?.reason).toBe('agent_config_invalid');
    expect(result.error?.agent_config_issue).toBe('step_config_invalid');
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

    const promise = executeAgentStep(buildAgentStep(), {signal: ac.signal, runtime: RUNTIME});
    ac.abort();
    const result = await promise;

    expect(result.success).toBe(false);
    expect(sawSignal).toBe(ac.signal);
  });

  it('fails without crashing when the signal is already aborted before the call', async () => {
    const ac = new AbortController();
    ac.abort();
    runAgentMock.mockRejectedValue(new Error('agent rejected after abort'));

    const result = await executeAgentStep(buildAgentStep(), {
      signal: ac.signal,
      runtime: RUNTIME,
    });

    expect(result.success).toBe(false);
  });
});
