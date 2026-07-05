import {agentThinkingByHarness, agentThinkingSchema} from './step-enums.js';

describe('agent thinking schemas', () => {
  it('keeps the public union equal to the per-harness options', () => {
    const perHarnessOptions = new Set(
      Object.values(agentThinkingByHarness).flatMap((schema) => schema.options),
    );

    expect(new Set(agentThinkingSchema.options)).toEqual(perHarnessOptions);
  });
});
