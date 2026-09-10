import {stepSummaryDtoSchema} from './workflow-job-detail.js';

const STEP_ID = '11111111-1111-4111-8111-111111111111';

describe('stepSummaryDtoSchema', () => {
  test('accepts an effective gate attempt limit', () => {
    const result = stepSummaryDtoSchema.parse(stepSummary({gate_max_attempts: 5}));

    expect(result.gate_max_attempts).toBe(5);
  });

  test('keeps the effective gate attempt limit optional', () => {
    const result = stepSummaryDtoSchema.parse(stepSummary());

    expect(result).not.toHaveProperty('gate_max_attempts');
  });
});

function stepSummary(overrides: Record<string, unknown> = {}) {
  return {
    id: STEP_ID,
    key: 'gate',
    name: 'gate',
    type: 'run',
    position: 0,
    status: 'failed',
    status_reason: null,
    source_location: null,
    current_attempt: 7,
    error: null,
    attempts: {items: [], next_cursor: null, total: 0},
    ...overrides,
  };
}
