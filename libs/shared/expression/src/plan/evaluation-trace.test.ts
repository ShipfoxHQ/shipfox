import {
  capTraceEntries,
  capTraceValue,
  EVALUATION_TRACE_MAX_ENTRIES,
  EVALUATION_TRACE_VALUE_CAP_BYTES,
  evaluationTraceEntry,
} from './evaluation-trace.js';

describe('evaluation trace', () => {
  it('caps values by UTF-8 bytes with an explicit marker', () => {
    const result = capTraceValue('x'.repeat(EVALUATION_TRACE_VALUE_CAP_BYTES + 1));

    expect(new TextEncoder().encode(result.value).byteLength).toBeLessThanOrEqual(
      EVALUATION_TRACE_VALUE_CAP_BYTES,
    );
    expect(result).toMatchObject({truncated: true});
    expect(result.value).toContain('...[truncated]');
  });

  it('caps expression source and omits values for references', () => {
    const entry = evaluationTraceEntry({
      expression: 'x'.repeat(EVALUATION_TRACE_VALUE_CAP_BYTES + 1),
      roots: ['secrets'],
      fillTarget: 'runner-fill',
      evaluatedAt: 'step-dispatch',
      value: 'raw-secret',
      reference: true,
    });

    expect(entry).toMatchObject({
      roots: ['secrets'],
      fillTarget: 'runner-fill',
      evaluatedAt: 'step-dispatch',
      reference: true,
      exprTruncated: true,
    });
    expect(entry).not.toHaveProperty('value');
  });

  it('adds a dropped marker when a row exceeds the entry cap', () => {
    const entries = Array.from({length: EVALUATION_TRACE_MAX_ENTRIES + 2}, (_, index) =>
      evaluationTraceEntry({
        expression: `run.value_${index}`,
        roots: ['run'],
        fillTarget: 'run-creation',
        evaluatedAt: 'run-creation',
        value: String(index),
      }),
    );

    const capped = capTraceEntries(entries);

    expect(capped).toHaveLength(EVALUATION_TRACE_MAX_ENTRIES);
    expect(capped.at(-1)).toEqual({truncated: true, dropped: 3});
  });
});
