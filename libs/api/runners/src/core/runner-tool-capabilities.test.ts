import type {RunnerToolCapabilitiesDto} from '@shipfox/api-runners-dto';
import {effectiveRunnerToolCapabilities} from './runner-tool-capabilities.js';

const capabilities: RunnerToolCapabilitiesDto = {
  harnesses: {
    pi: {tools: ['read', 'bash']},
  },
};

describe('effectiveRunnerToolCapabilities', () => {
  it('returns an empty set when the report is missing', () => {
    const effective = effectiveRunnerToolCapabilities({
      toolCapabilities: null,
      reportedAt: new Date('2026-01-01T00:00:00.000Z'),
      staleAfterSeconds: 10,
      now: new Date('2026-01-01T00:00:01.000Z'),
    });

    expect(effective).toEqual({harnesses: {}});
  });

  it('returns an empty set when the report timestamp is missing', () => {
    const effective = effectiveRunnerToolCapabilities({
      toolCapabilities: capabilities,
      reportedAt: null,
      staleAfterSeconds: 10,
      now: new Date('2026-01-01T00:00:01.000Z'),
    });

    expect(effective).toEqual({harnesses: {}});
  });

  it('returns an empty set when the report is stale', () => {
    const effective = effectiveRunnerToolCapabilities({
      toolCapabilities: capabilities,
      reportedAt: new Date('2026-01-01T00:00:00.000Z'),
      staleAfterSeconds: 10,
      now: new Date('2026-01-01T00:00:11.000Z'),
    });

    expect(effective).toEqual({harnesses: {}});
  });

  it('returns exact persisted tools when the report is fresh', () => {
    const effective = effectiveRunnerToolCapabilities({
      toolCapabilities: capabilities,
      reportedAt: new Date('2026-01-01T00:00:00.000Z'),
      staleAfterSeconds: 10,
      now: new Date('2026-01-01T00:00:10.000Z'),
    });

    expect(effective).toBe(capabilities);
  });
});
