import {agentRuntimeConfigQuerySchema} from './agent-runtime-config.js';

describe('agentRuntimeConfigQuerySchema', () => {
  it('coerces the attempt query param', () => {
    const stepId = crypto.randomUUID();

    const parsed = agentRuntimeConfigQuerySchema.parse({step_id: stepId, attempt: '2'});

    expect(parsed).toEqual({step_id: stepId, attempt: 2});
  });

  it('rejects malformed query params', () => {
    const parse = () => agentRuntimeConfigQuerySchema.parse({step_id: 'step-1', attempt: '0'});

    expect(parse).toThrow();
  });
});
