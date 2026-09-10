import {
  AGENT_ACCESS_ERROR_DETAIL_STRING_MAX_BYTES,
  AGENT_ACCESS_ERROR_DETAILS_MAX_BYTES,
  agentAccessEnvelopeJsonSchema,
  agentAccessEnvelopeSchema,
  agentAccessOutputSchema,
} from './envelope.js';

describe('agent access envelope', () => {
  test('accepts the common success and error wire shapes', () => {
    expect(agentAccessEnvelopeSchema.safeParse({ok: true, result: {projects: []}}).success).toBe(
      true,
    );
    expect(
      agentAccessEnvelopeSchema.safeParse({
        ok: false,
        error: {code: 'rate-limited', retry_after_seconds: 12},
      }).success,
    ).toBe(true);
  });

  test('accepts bounded error details and rejects oversized detail strings or payloads', () => {
    expect(
      agentAccessEnvelopeSchema.safeParse({
        ok: false,
        error: {code: 'attempt-mismatch', details: {current_attempt: 2}},
      }).success,
    ).toBe(true);
    expect(
      agentAccessEnvelopeSchema.safeParse({
        ok: false,
        error: {code: 'bad', details: {reason: '🙂'.repeat(300)}},
      }).success,
    ).toBe(false);
    const detailValue = 'x'.repeat(AGENT_ACCESS_ERROR_DETAIL_STRING_MAX_BYTES - 1);
    const oversizedDetails = Object.fromEntries(
      Array.from(
        {length: Math.ceil(AGENT_ACCESS_ERROR_DETAILS_MAX_BYTES / detailValue.length) + 1},
        (_, index) => [`reason_${index}`, detailValue],
      ),
    );
    expect(
      agentAccessEnvelopeSchema.safeParse({
        ok: false,
        error: {code: 'bad', details: oversizedDetails},
      }).success,
    ).toBe(false);
  });

  test('rejects detail strings emitted by toJSON', () => {
    const serializedDetail = 'x'.repeat(AGENT_ACCESS_ERROR_DETAIL_STRING_MAX_BYTES + 1);
    const details = {
      reason: {
        toJSON: () => serializedDetail,
      },
    };

    expect(JSON.stringify(details).length).toBeLessThan(AGENT_ACCESS_ERROR_DETAILS_MAX_BYTES);
    expect(
      agentAccessEnvelopeSchema.safeParse({
        ok: false,
        error: {code: 'bad', details},
      }).success,
    ).toBe(false);
  });

  test('rejects mixed success and error payloads', () => {
    expect(
      agentAccessEnvelopeSchema.safeParse({ok: true, result: {}, error: {code: 'bad'}}).success,
    ).toBe(false);
    expect(agentAccessEnvelopeSchema.safeParse({ok: false}).success).toBe(false);
  });

  test('declares one object schema for both response outcomes', () => {
    expect(agentAccessEnvelopeJsonSchema.type).toBe('object');
    expect(agentAccessEnvelopeJsonSchema).not.toHaveProperty('oneOf');
    expect(agentAccessOutputSchema({type: 'object'})).toMatchObject({
      type: 'object',
      properties: {result: {type: 'object'}},
      required: ['ok'],
    });
  });
});
