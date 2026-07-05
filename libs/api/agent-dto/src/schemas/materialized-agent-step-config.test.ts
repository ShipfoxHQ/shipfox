import {materializedAgentStepConfigSchema} from './materialized-agent-step-config.js';

describe('materializedAgentStepConfigSchema', () => {
  it('accepts a materialized agent step config', () => {
    const parsed = materializedAgentStepConfigSchema.parse({
      harness: 'pi',
      provider: 'anthropic',
      model: 'claude-opus-4-8',
      thinking: 'high',
      prompt: 'Fix the failing tests.',
    });

    expect(parsed).toEqual({
      harness: 'pi',
      provider: 'anthropic',
      model: 'claude-opus-4-8',
      thinking: 'high',
      prompt: 'Fix the failing tests.',
    });
  });

  it('accepts a custom provider ref', () => {
    const parsed = materializedAgentStepConfigSchema.parse({
      harness: 'pi',
      provider: 'local-vllm',
      model: 'llama-3.1',
      thinking: 'high',
      prompt: 'Fix the failing tests.',
    });

    expect(parsed.provider).toBe('local-vllm');
  });

  it('defaults a missing harness for stored materialized configs', () => {
    const parsed = materializedAgentStepConfigSchema.parse({
      provider: 'anthropic',
      model: 'claude-opus-4-8',
      thinking: 'high',
      prompt: 'Fix the failing tests.',
    });

    expect(parsed.harness).toBe('pi');
  });

  it('rejects missing fields and strips extra fields', () => {
    const missingField = () =>
      materializedAgentStepConfigSchema.parse({
        harness: 'pi',
        provider: 'anthropic',
        model: 'claude-opus-4-8',
        prompt: 'Fix the failing tests.',
      });
    const extraField = materializedAgentStepConfigSchema.parse({
      harness: 'pi',
      provider: 'anthropic',
      model: 'claude-opus-4-8',
      thinking: 'high',
      prompt: 'Fix the failing tests.',
      gate: {success: 'ok'},
    });

    expect(missingField).toThrow();
    expect(extraField).toEqual({
      harness: 'pi',
      provider: 'anthropic',
      model: 'claude-opus-4-8',
      thinking: 'high',
      prompt: 'Fix the failing tests.',
    });
  });
});
