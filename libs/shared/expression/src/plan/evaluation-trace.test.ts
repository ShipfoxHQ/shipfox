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

  it('caps values without splitting multi-byte characters', () => {
    const result = capTraceValue('é'.repeat(EVALUATION_TRACE_VALUE_CAP_BYTES));

    expect(new TextEncoder().encode(result.value).byteLength).toBeLessThanOrEqual(
      EVALUATION_TRACE_VALUE_CAP_BYTES,
    );
    expect(result).toMatchObject({truncated: true});
    expect(result.value).toContain('...[truncated]');
    expect(result.value.at(-('...[truncated]'.length + 1))).toBe('é');
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

  it('absorbs existing dropped markers when capping again', () => {
    const entries = Array.from({length: EVALUATION_TRACE_MAX_ENTRIES}, (_, index) =>
      evaluationTraceEntry({
        expression: `run.value_${index}`,
        roots: ['run'],
        fillTarget: 'run-creation',
        evaluatedAt: 'run-creation',
        value: String(index),
      }),
    );
    const capped = capTraceEntries([...entries, {truncated: true, dropped: 4}]);

    const recapped = capTraceEntries([
      ...capped,
      evaluationTraceEntry({
        expression: 'run.late',
        roots: ['run'],
        fillTarget: 'run-creation',
        evaluatedAt: 'run-creation',
        value: 'late',
      }),
    ]);

    expect(recapped).toHaveLength(EVALUATION_TRACE_MAX_ENTRIES);
    expect(recapped.at(-1)).toEqual({truncated: true, dropped: 6});
  });
});
