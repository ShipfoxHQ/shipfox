import {runnerToolCapabilitiesSchema} from './tool-capabilities.js';

describe('runnerToolCapabilitiesSchema', () => {
  it('accepts a full capability report', () => {
    const result = runnerToolCapabilitiesSchema.safeParse({
      harnesses: {
        pi: {tools: ['read', 'bash', 'web_search']},
        claude: {tools: ['Read', 'Bash', 'WebSearch']},
      },
    });

    expect(result.success).toBe(true);
  });

  it('accepts a partial capability report', () => {
    const result = runnerToolCapabilitiesSchema.safeParse({
      harnesses: {
        pi: {tools: ['read']},
      },
    });

    expect(result.success).toBe(true);
  });

  it('accepts no harness support', () => {
    const result = runnerToolCapabilitiesSchema.safeParse({harnesses: {}});

    expect(result.success).toBe(true);
  });

  it('accepts an empty tool array', () => {
    const result = runnerToolCapabilitiesSchema.safeParse({
      harnesses: {
        claude: {tools: []},
      },
    });

    expect(result.success).toBe(true);
  });

  it('rejects duplicate tool names per harness', () => {
    const result = runnerToolCapabilitiesSchema.safeParse({
      harnesses: {
        pi: {tools: ['read', 'read']},
      },
    });

    expect(result.success).toBe(false);
  });

  it.each([
    null,
    {},
    {harnesses: {}, extra: true},
    {harnesses: {pi: {tools: ['read']}, unknown: {tools: ['x']}}},
    {harnesses: {pi: {tools: ['read'], extra: true}}},
    {harnesses: {pi: {tools: ['']}}},
    {harnesses: {pi: {tools: [42]}}},
  ])('rejects malformed capability report %#', (value) => {
    const result = runnerToolCapabilitiesSchema.safeParse(value);

    expect(result.success).toBe(false);
  });
});
