import {
  MAX_OUTPUT_TOTAL_BYTES,
  MAX_OUTPUT_VALUE_BYTES,
} from '@shipfox/runner-execution/step-output';
import {MAX_OUTPUT_REPROMPTS, OutputCollector, runOutputTurnLoop} from '#core/output-collector.js';

describe('OutputCollector', () => {
  it('accepts declared scalar outputs as string values', () => {
    const collector = new OutputCollector({
      count: {type: 'number'},
      passed: {type: 'boolean'},
    });

    const count = collector.trySet('count', '42');
    const passed = collector.trySet('passed', 'true');

    expect(count).toEqual({ok: true});
    expect(passed).toEqual({ok: true});
    expect(collector.snapshot()).toEqual({count: '42', passed: 'true'});
    expect(collector.missingRequired()).toEqual([]);
  });

  it('rejects undeclared keys on typed steps', () => {
    const collector = new OutputCollector({count: {type: 'number'}});

    const result = collector.trySet('extra', 'value');

    expect(result).toEqual({
      ok: false,
      feedback: 'Output "extra" is not declared by the step output schema.',
    });
    expect(collector.snapshot()).toEqual({});
  });

  it('accepts valid arbitrary keys for untyped steps', () => {
    const collector = new OutputCollector(undefined);

    const result = collector.trySet('summary-text', 'done');

    expect(result).toEqual({ok: true});
    expect(collector.snapshot()).toEqual({'summary-text': 'done'});
  });

  it('rejects invalid output keys', () => {
    const collector = new OutputCollector(undefined);

    const result = collector.trySet('bad key', 'value');

    expect(result.ok).toBe(false);
    expect(result).toMatchObject({feedback: expect.stringContaining('Output key "bad key"')});
  });

  it('returns coercion feedback for invalid values without storing them', () => {
    const collector = new OutputCollector({count: {type: 'number'}});

    const result = collector.trySet('count', 'not-a-number');

    expect(result).toEqual({
      ok: false,
      feedback: 'Output "count" must be a finite number or numeric string.',
    });
    expect(collector.missingRequired()).toEqual(['count']);
    expect(collector.snapshot()).toEqual({});
  });

  it('validates json outputs from JSON text', () => {
    const collector = new OutputCollector({
      meta: {
        type: 'json',
        schema: {
          type: 'object',
          properties: {name: {type: 'string'}},
          required: ['name'],
          additionalProperties: false,
        },
      },
    });

    const result = collector.trySet('meta', '{"name":"api"}');

    expect(result).toEqual({ok: true});
    expect(collector.snapshot()).toEqual({meta: '{"name":"api"}'});
  });

  it('rejects values over the per-value cap', () => {
    const collector = new OutputCollector(undefined);

    const result = collector.trySet('large', 'x'.repeat(MAX_OUTPUT_VALUE_BYTES + 1));

    expect(result).toEqual({
      ok: false,
      feedback: `Output "large" exceeds the per-value size limit of ${MAX_OUTPUT_VALUE_BYTES} bytes.`,
    });
  });

  it('rejects output maps over the total cap', () => {
    const collector = new OutputCollector(undefined);
    let first = {ok: true} as ReturnType<OutputCollector['trySet']>;
    for (let index = 0; index < 4; index += 1) {
      first = collector.trySet(`chunk_${index}`, 'x'.repeat(MAX_OUTPUT_VALUE_BYTES - 20));
    }
    const second = collector.trySet('overflow', 'y'.repeat(100));

    expect(first).toEqual({ok: true});
    expect(second).toEqual({
      ok: false,
      feedback: `Step outputs exceed the total size limit of ${MAX_OUTPUT_TOTAL_BYTES} bytes.`,
    });
  });

  it('lists missing required outputs and describes json-as-text guidance', () => {
    const collector = new OutputCollector({
      meta: {type: 'json'},
      summary: {type: 'string'},
    });

    collector.trySet('summary', 'done');

    expect(collector.missingRequired()).toEqual(['meta']);
    expect(collector.guidanceText()).toContain('For json outputs, pass value as JSON text.');
    expect(collector.guidanceText()).toContain('- meta: json as JSON text');
  });
});

describe('runOutputTurnLoop', () => {
  it('fails after exhausting required-output reprompts', async () => {
    const runTurn = vi.fn<Parameters<typeof runOutputTurnLoop>[0]['runTurn']>();
    const controller = new AbortController();

    const result = runOutputTurnLoop({
      signal: controller.signal,
      prompt: 'Set the answer output.',
      runTurn,
      missingRequired: () => ['answer'],
    });

    await expect(result).rejects.toThrow('Agent step finished without required outputs: answer');
    expect(runTurn).toHaveBeenCalledTimes(MAX_OUTPUT_REPROMPTS + 1);
    expect(runTurn).toHaveBeenLastCalledWith(
      'The previous turn ended without setting required workflow outputs: answer. ' +
        'Call set_output for each missing key, then provide your final response.',
    );
  });

  it('reports missing outputs when the provider rejects a correction turn', async () => {
    const runTurn = vi
      .fn<Parameters<typeof runOutputTurnLoop>[0]['runTurn']>()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('Cannot continue from message role: assistant'));
    const controller = new AbortController();

    const result = runOutputTurnLoop({
      signal: controller.signal,
      prompt: 'Set the answer output.',
      runTurn,
      missingRequired: () => ['answer'],
    });

    await expect(result).rejects.toThrow('Agent step finished without required outputs: answer');
    expect(runTurn).toHaveBeenCalledTimes(2);
  });

  it('stops before the next turn when aborted mid-loop', async () => {
    const controller = new AbortController();
    const runTurn = vi.fn<Parameters<typeof runOutputTurnLoop>[0]['runTurn']>();

    const result = runOutputTurnLoop({
      signal: controller.signal,
      prompt: 'Set the answer output.',
      runTurn,
      missingRequired: () => {
        controller.abort();
        return ['answer'];
      },
    });

    await expect(result).rejects.toThrow('Agent step aborted');
    expect(runTurn).toHaveBeenCalledOnce();
  });
});
