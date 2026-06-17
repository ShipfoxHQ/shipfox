import {stepDtoSchema, stepSourceLocationSchema} from './step.js';

const baseStep = {
  id: '11111111-1111-4111-8111-111111111111',
  job_id: '22222222-2222-4222-8222-222222222222',
  name: null,
  status: 'pending',
  type: 'run',
  config: {run: 'echo hello'},
  error: null,
  position: 1,
  current_attempt: 1,
  created_at: '2026-06-16T00:00:00.000Z',
  updated_at: '2026-06-16T00:00:00.000Z',
};

describe('step source location schemas', () => {
  test('accepts valid source locations', () => {
    const result = stepSourceLocationSchema.parse({start_line: 5, end_line: 8});

    expect(result).toEqual({start_line: 5, end_line: 8});
  });

  test('rejects inverted source locations', () => {
    const result = stepSourceLocationSchema.safeParse({start_line: 8, end_line: 5});

    expect(result.success).toBe(false);
  });

  test('accepts step DTOs with source locations', () => {
    const result = stepDtoSchema.parse({
      ...baseStep,
      source_location: {start_line: 5, end_line: 8},
    });

    expect(result.source_location).toEqual({start_line: 5, end_line: 8});
  });

  test('accepts step DTOs with null source locations', () => {
    const result = stepDtoSchema.parse({...baseStep, source_location: null});

    expect(result.source_location).toBeNull();
  });
});
