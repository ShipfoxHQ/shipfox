import {evaluationTraceRowEntryDtoSchema} from './evaluation-trace.js';

describe('evaluationTraceRowEntryDtoSchema', () => {
  it('accepts a predicate trace entry with its evaluated value', () => {
    const result = evaluationTraceRowEntryDtoSchema.parse({
      field: 'step.if',
      expression: "steps.test.status == 'failed'",
      roots: ['steps'],
      fill_target: 'step-dispatch',
      evaluated_at: 'step-dispatch',
      value: 'false',
    });

    expect(result).toEqual({
      field: 'step.if',
      expression: "steps.test.status == 'failed'",
      roots: ['steps'],
      fill_target: 'step-dispatch',
      evaluated_at: 'step-dispatch',
      value: 'false',
    });
  });

  it('accepts a degraded (condition_errored) entry without a value', () => {
    const result = evaluationTraceRowEntryDtoSchema.parse({
      field: 'step.if',
      expression: 'steps.build.outputs.redy',
      roots: ['steps'],
      fill_target: 'step-dispatch',
      evaluated_at: 'step-dispatch',
      degraded: true,
    });

    expect(result).toMatchObject({degraded: true});
    expect('value' in result ? result.value : undefined).toBeUndefined();
  });

  it('accepts a trailing limit marker', () => {
    const result = evaluationTraceRowEntryDtoSchema.parse({truncated: true, dropped: 3});

    expect(result).toEqual({truncated: true, dropped: 3});
  });

  it('rejects an entry missing the field key', () => {
    const result = evaluationTraceRowEntryDtoSchema.safeParse({
      expression: 'true',
      roots: [],
      fill_target: 'job-activation',
      evaluated_at: 'job-activation',
      value: 'true',
    });

    expect(result.success).toBe(false);
  });
});
