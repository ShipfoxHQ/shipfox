import {
  getStepLogDownloadInputJsonSchema,
  getStepLogDownloadInputSchema,
  getStepLogDownloadResultJsonSchema,
  getStepLogDownloadResultSchema,
  getStepLogsResultJsonSchema,
  getStepLogsResultSchema,
} from './log-tools.js';

const runId = '00000000-0000-4000-8000-000000000001';
const stepId = '00000000-0000-4000-8000-000000000002';

describe('log Agent Access schemas', () => {
  test('requires total_lines only for compacted downloads', () => {
    const base = {
      step_id: stepId,
      attempt: 1,
      url: 'https://api.example.test/step-log-downloads/current',
      token: 'token',
      expires_at: '2026-09-11T10:05:00.000Z',
      state: 'closed',
      total_bytes: 12,
      truncated: false,
    };

    expect(getStepLogDownloadInputSchema.safeParse({step_id: stepId}).success).toBe(true);
    expect(getStepLogDownloadInputJsonSchema.required).toEqual(['step_id']);
    expect(getStepLogDownloadResultSchema.safeParse({...base, compacted: false}).success).toBe(
      true,
    );
    expect(getStepLogDownloadResultSchema.safeParse({...base, compacted: true}).success).toBe(
      false,
    );
    expect(
      getStepLogDownloadResultSchema.safeParse({...base, compacted: true, total_lines: 2}).success,
    ).toBe(true);
    expect(getStepLogDownloadResultJsonSchema.oneOf[1].required).toContain('total_lines');
  });

  test('accepts unavailable aggregate sections in runtime and JSON schemas', () => {
    const result = {
      run_id: runId,
      workflow_run_attempt: 1,
      sections: [
        {
          step_id: stepId,
          attempt: 1,
          content: '',
          unavailable_reason: 'compacted-log-unavailable',
        },
      ],
    };

    expect(getStepLogsResultSchema.safeParse(result).success).toBe(true);
    expect(
      getStepLogsResultJsonSchema.oneOf[1].properties.sections.items.properties.unavailable_reason,
    ).toEqual({const: 'compacted-log-unavailable'});
  });
});
