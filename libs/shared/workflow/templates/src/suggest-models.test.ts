import {type SuggestionModel, suggestModels} from './suggest-models.js';

const measured = (
  thinking: SuggestionModel['thinking'],
  intelligence_index: number,
  cost_per_task_usd: number,
  scale = 'coding-v1',
) => ({
  thinking,
  intelligence_index,
  cost_per_task_usd,
  scale,
});

function model(
  id: string,
  supported_thinking: SuggestionModel['supported_thinking'],
  references: SuggestionModel['references'],
  thinking: SuggestionModel['thinking'] = 'medium',
): SuggestionModel {
  return {
    id,
    provider: 'provider',
    harness: 'pi',
    thinking,
    supported_thinking,
    references,
    price: null,
  };
}

const tested = {
  reference: {model: 'tested', thinking: 'medium' as const},
  note: 'Tested on a coding task.',
};

describe('suggestModels', () => {
  test('suggests the cheaper qualifying effort and keeps unscored choices manual', () => {
    const testedModel = model(
      'tested',
      ['high', 'medium', 'low'],
      [measured('medium', 80, 4), measured('high', 90, 6)],
    );
    const cheaper = model(
      'cheaper',
      ['high', 'low', 'medium'],
      [measured('low', 70, 1), measured('medium', 80, 2), measured('high', 85, 3)],
    );
    const unscored = model('custom', ['off', 'default'], []);

    const result = suggestModels(tested, {
      models: [testedModel, cheaper, unscored],
      default_model: testedModel,
      attribution: 'Benchmark source',
    });

    expect(result.outcome).toBe('suggested');
    expect(result.reference).toEqual({model: 'tested', thinking: 'medium', intelligence_index: 80});
    expect(result.note).toBe('Tested on a coding task.');
    expect(result.attribution).toBe('Benchmark source');
    expect(
      result.models.map(({id, thinking, below_reference, is_default}) => [
        id,
        thinking,
        below_reference,
        is_default,
      ]),
    ).toEqual([
      ['cheaper', 'medium', undefined, false],
      ['cheaper', 'high', undefined, false],
      ['tested', 'medium', undefined, true],
      ['tested', 'high', undefined, false],
      ['cheaper', 'low', true, false],
      ['tested', 'low', undefined, false],
      ['custom', 'off', undefined, false],
      ['custom', 'default', undefined, false],
    ]);
    expect(result.models[0]?.reference).toEqual(measured('medium', 80, 2));
  });

  test('suggests only the higher effort when it alone clears the threshold', () => {
    const result = suggestModels(tested, {
      models: [
        model('tested', ['medium'], [measured('medium', 80, 4)]),
        model('candidate', ['low', 'high'], [measured('low', 79.99, 1), measured('high', 81, 2)]),
      ],
      default_model: null,
      attribution: 'Benchmark source',
    });

    expect(result.models[0]).toMatchObject({
      id: 'candidate',
      thinking: 'high',
      reference: measured('high', 81, 2),
    });
    expect(result.models[2]).toMatchObject({
      id: 'candidate',
      thinking: 'low',
      below_reference: true,
    });
  });

  test('supports a max-only measurement and breaks cost ties by catalog and thinking order', () => {
    const result = suggestModels(tested, {
      models: [
        model('tested', ['medium'], [measured('medium', 80, 5)]),
        model('max-only', ['max', 'low'], [measured('max', 80, 2)]),
        model('multi', ['default', 'high'], [measured('default', 80, 2), measured('high', 80, 2)]),
      ],
      default_model: null,
      attribution: 'Benchmark source',
    });

    expect(result.models.slice(0, 3).map(({id, thinking}) => [id, thinking])).toEqual([
      ['max-only', 'max'],
      ['multi', 'high'],
      ['multi', 'default'],
    ]);
    expect(result.models.at(-1)).toMatchObject({id: 'max-only', thinking: 'low', reference: null});
  });

  test('keeps verified provider default separate from off and workspace default', () => {
    const current = model(
      'tested',
      ['default', 'off', 'medium'],
      [measured('default', 80, 2), measured('off', 60, 1), measured('medium', 80, 4)],
    );
    const result = suggestModels(tested, {
      models: [current],
      default_model: current,
      attribution: 'Benchmark source',
    });

    expect(result.models[0]).toMatchObject({
      thinking: 'default',
      is_default: false,
      reference: measured('default', 80, 2),
    });
    expect(result.models[1]).toMatchObject({thinking: 'medium', is_default: true});
    expect(result.models[2]).toMatchObject({thinking: 'off', below_reference: true});
  });

  test('flags the default only for the exact provider, model, and thinking', () => {
    const first = model('shared-id', ['medium'], []);
    const second = {
      ...model('shared-id', ['medium', 'high'], [], 'high'),
      provider: 'other-provider',
    };

    const result = suggestModels(
      {note: 'Choose a model.'},
      {
        models: [first, second],
        default_model: second,
        attribution: null,
      },
    );

    expect(
      result.models.map(({provider, thinking, is_default}) => [provider, thinking, is_default]),
    ).toEqual([
      ['provider', 'medium', false],
      ['other-provider', 'medium', false],
      ['other-provider', 'high', true],
    ]);
  });

  test('lists choices when multiple providers match the tested model and thinking', () => {
    const first = model('tested', ['medium'], [measured('medium', 80, 4)]);
    const second = {
      ...model('tested', ['medium'], [measured('medium', 90, 3)]),
      provider: 'other-provider',
    };
    const candidate = model('candidate', ['medium'], [measured('medium', 85, 2)]);

    const result = suggestModels(tested, {
      models: [first, second, candidate],
      default_model: null,
      attribution: 'Benchmark source',
    });

    expect(result).toMatchObject({outcome: 'list', reference: null});
    expect(result.models.map(({provider, below_reference}) => [provider, below_reference])).toEqual(
      [
        ['provider', undefined],
        ['other-provider', undefined],
        ['provider', undefined],
      ],
    );
  });

  test.each([
    {name: 'missing reference', placeholder: {note: 'Choose a model.'}},
    {
      name: 'unscored reference effort',
      placeholder: {reference: {model: 'tested', thinking: 'high' as const}},
    },
  ])('lists without ranking for $name', ({placeholder}) => {
    const current = model('tested', ['high', 'medium', 'low'], [measured('medium', 80, 4)]);

    const result = suggestModels(placeholder, {
      models: [current],
      default_model: current,
      attribution: 'Benchmark source',
    });

    expect(result).toMatchObject({outcome: 'list', reference: null});
    expect(
      result.models.map(({thinking, below_reference, is_default}) => [
        thinking,
        below_reference,
        is_default,
      ]),
    ).toEqual([
      ['low', undefined, false],
      ['medium', undefined, true],
      ['high', undefined, false],
    ]);
  });

  test('lists all choices when scored candidates have mixed scales', () => {
    const result = suggestModels(tested, {
      models: [
        model('tested', ['medium'], [measured('medium', 80, 4)]),
        model('other', ['high'], [measured('high', 90, 1, 'coding-v2')]),
      ],
      default_model: null,
      attribution: 'Benchmark source',
    });

    expect(result.outcome).toBe('list');
    expect(result.reference).toEqual({model: 'tested', thinking: 'medium', intelligence_index: 80});
    expect(result.models.every((choice) => choice.below_reference === undefined)).toBe(true);
  });

  test.each([
    {name: 'unscored catalog', models: [model('tested', ['medium'], [])], expected: 1},
    {name: 'no models', models: [], expected: 0},
  ])('lists $name without a suggestion', ({models, expected}) => {
    const result = suggestModels(tested, {models, default_model: null, attribution: null});

    expect(result).toMatchObject({outcome: 'list', reference: null, attribution: null});
    expect(result.models).toHaveLength(expected);
  });
});
