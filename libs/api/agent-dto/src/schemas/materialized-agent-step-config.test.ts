import {materializedAgentStepConfigSchema} from './materialized-agent-step-config.js';

describe('materializedAgentStepConfigSchema', () => {
  it('accepts a materialized agent step config', () => {
    const parsed = materializedAgentStepConfigSchema.parse({
      provider: 'anthropic',
      model: 'claude-opus-4-8',
      thinking: 'high',
      prompt: 'Fix the failing tests.',
    });

    expect(parsed).toEqual({
      provider: 'anthropic',
      model: 'claude-opus-4-8',
      thinking: 'high',
      prompt: 'Fix the failing tests.',
    });
  });

  it('rejects a custom provider ref until custom runtime resolution is supported', () => {
    const parse = () =>
      materializedAgentStepConfigSchema.parse({
        provider: 'local-vllm',
        model: 'llama-3.1',
        thinking: 'high',
        prompt: 'Fix the failing tests.',
      });

    expect(parse).toThrow();
  });

  it('rejects missing fields and strips extra fields', () => {
    const missingField = () =>
      materializedAgentStepConfigSchema.parse({
        provider: 'anthropic',
        model: 'claude-opus-4-8',
        prompt: 'Fix the failing tests.',
      });
    const extraField = materializedAgentStepConfigSchema.parse({
      provider: 'anthropic',
      model: 'claude-opus-4-8',
      thinking: 'high',
      prompt: 'Fix the failing tests.',
      gate: {success_if: 'ok'},
    });

    expect(missingField).toThrow();
    expect(extraField).toEqual({
      provider: 'anthropic',
      model: 'claude-opus-4-8',
      thinking: 'high',
      prompt: 'Fix the failing tests.',
    });
  });
});
