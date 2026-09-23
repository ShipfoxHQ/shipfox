import {agentThinkingByHarness, agentThinkingSchema} from './step-enums.js';

describe('agent thinking schemas', () => {
  it('accepts provider-default thinking for both harnesses', () => {
    const pi = agentThinkingByHarness.pi.parse('default');
    const claude = agentThinkingByHarness.claude.parse('default');

    expect(pi).toBe('default');
    expect(claude).toBe('default');
    expect(agentThinkingSchema.options.at(-1)).toBe('default');
  });

  it('keeps the public union equal to the per-harness options', () => {
    const perHarnessOptions = new Set(
      Object.values(agentThinkingByHarness).flatMap((schema) => schema.options),
    );

    expect(new Set(agentThinkingSchema.options)).toEqual(perHarnessOptions);
  });
});
