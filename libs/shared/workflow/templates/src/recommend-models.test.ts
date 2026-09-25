import {
  type RecommendationAnchor,
  type RecommendationModel,
  recommendModels,
} from './recommend-models.js';

const reference = (
  thinking: RecommendationModel['references'][number]['thinking'],
  intelligence_index: number,
  cost_per_task_usd: number,
  scale = 'coding-v1',
) => ({thinking, intelligence_index, cost_per_task_usd, scale});

function model(
  id: string,
  lab: string | null,
  references: RecommendationModel['references'],
): RecommendationModel {
  return {id, lab, references};
}

const anchor: RecommendationAnchor = {
  model: 'anchor',
  thinking: 'medium',
  lab: 'Anchor Lab',
  intelligence_index: 80,
  cost_per_task_usd: 4,
  scale: 'coding-v1',
};

function picked(result: ReturnType<typeof recommendModels>) {
  return result.map(({model, lab, thinking, intelligence_index, cost_per_task_usd}) => ({
    model,
    lab,
    thinking,
    intelligence_index,
    cost_per_task_usd,
  }));
}

describe('recommendModels', () => {
  test('selects cheaper and smarter alternatives from the whole pool, including the anchor lab', () => {
    const result = recommendModels({
      anchor,
      models: [
        model('anchor', 'Anchor Lab', [reference('medium', 80, 4), reference('high', 90, 5)]),
        model('anchor-lab-cheaper', 'Anchor Lab', [reference('low', 78, 1)]),
        model('other-cheaper', 'Other Lab', [reference('low', 79, 2)]),
        model('smarter', 'Other Lab', [reference('high', 85, 3)]),
      ],
    });

    expect(picked(result)).toEqual(
      expect.arrayContaining([
        {
          model: 'smarter',
          lab: 'Other Lab',
          thinking: 'high',
          intelligence_index: 85,
          cost_per_task_usd: 3,
        },
        {
          model: 'anchor-lab-cheaper',
          lab: 'Anchor Lab',
          thinking: 'low',
          intelligence_index: 78,
          cost_per_task_usd: 1,
        },
      ]),
    );
  });

  test('uses a smarter model for the smarter slot even when its lab has a close-score model', () => {
    const result = recommendModels({
      anchor,
      models: [
        model('close', 'New Lab', [reference('low', 81, 1)]),
        model('smarter', 'New Lab', [reference('high', 85, 2)]),
      ],
    });

    expect(result.map(({model: id}) => id)).toEqual(['smarter', 'close']);
  });

  test('does not reuse a model when one combination qualifies for both slots', () => {
    const result = recommendModels({
      anchor,
      models: [
        model('both', 'Lab', [reference('high', 85, 1)]),
        model('fill', 'Other Lab', [reference('medium', 80, 2)]),
      ],
    });

    expect(result.map(({model: id}) => id)).toEqual(['both', 'fill']);
  });

  test('excludes every thinking level of the anchor model and unscored or unqualified models', () => {
    const result = recommendModels({
      anchor,
      models: [
        model('anchor', 'Anchor Lab', [reference('low', 79, 1), reference('high', 85, 1)]),
        model('unscored', 'Lab', []),
        model('wrong-scale', 'Lab', [reference('medium', 90, 1, 'other')]),
        model('too-far', 'Lab', [reference('medium', 91, 1)]),
        model('no-lab', null, [reference('medium', 80, 1)]),
      ],
    });

    expect(result).toEqual([]);
  });

  test('prefers unrepresented labs for fill, then falls back to any lab', () => {
    const result = recommendModels({
      anchor,
      models: [
        model('represented', 'Anchor Lab', [reference('medium', 80, 10)]),
        model('new-lab', 'New Lab', [reference('low', 79, 10)]),
        model('another-lab', 'Another Lab', [reference('high', 81, 10)]),
        model('fallback', 'New Lab', [reference('medium', 80, 10)]),
        model('last', 'Another Lab', [reference('medium', 80, 10)]),
        model('third-lab', 'Third Lab', [reference('medium', 80, 10)]),
      ],
    });

    expect(result.map(({model: id}) => id)).toEqual([
      'represented',
      'fallback',
      'last',
      'third-lab',
    ]);
  });

  test.each([
    {name: 'smarter at three points', index: 83, expected: 'similar'},
    {name: 'smarter above three points', index: 83.01, expected: 'slightly_smarter'},
    {name: 'less capable at negative three points', index: 77, expected: 'similar'},
    {
      name: 'less capable below negative three points',
      index: 76.99,
      expected: 'slightly_less_capable',
    },
  ])('labels intelligence band edges for $name', ({index, expected}) => {
    const result = recommendModels({
      anchor,
      models: [model('candidate', 'Lab', [reference('medium', index, 2)])],
    });

    expect(result[0]?.tradeoff.intelligence).toBe(expected);
  });

  test('includes the ten-point band edge and excludes values beyond it', () => {
    const result = recommendModels({
      anchor,
      models: [
        model('edge', 'Edge Lab', [reference('medium', 90, 1)]),
        model('outside', 'Outside Lab', [reference('medium', 90.01, 1)]),
      ],
    });

    expect(result.map(({model: id}) => id)).toEqual(['edge']);
  });

  test.each([
    {cost: 1, expected: 'much_cheaper'},
    {cost: 4 / 3, expected: 'cheaper'},
    {cost: 3.2, expected: 'similar'},
    {cost: 3.2 - 1e-10, expected: 'cheaper'},
    {cost: 5, expected: 'similar'},
    {cost: 5 + 1e-10, expected: 'more_expensive'},
    {cost: 12, expected: 'more_expensive'},
    {cost: 12 + 1e-10, expected: 'much_more_expensive'},
  ])('labels cost band edge at $cost', ({cost, expected}) => {
    const result = recommendModels({
      anchor,
      models: [model('candidate', 'Lab', [reference('medium', 80, cost)])],
    });

    expect(result[0]?.tradeoff.cost).toBe(expected);
  });

  test('includes dimension-specific display copy in every tradeoff label', () => {
    const result = recommendModels({
      anchor,
      models: [model('candidate', 'Lab', [reference('medium', 80, 4)])],
    });

    expect(result[0]?.tradeoff).toEqual({
      intelligence: 'similar',
      cost: 'similar',
      label: 'Similar intelligence, similar cost',
    });
  });

  test('uses similar cost for zero-cost alternatives and much more expensive otherwise', () => {
    const result = recommendModels({
      anchor: {...anchor, cost_per_task_usd: 0},
      models: [
        model('free', 'Free Lab', [reference('medium', 80, 0)]),
        model('paid', 'Paid Lab', [reference('medium', 81, 1)]),
      ],
    });

    expect(result.map(({model: id, tradeoff}) => [id, tradeoff.cost])).toEqual([
      ['paid', 'much_more_expensive'],
      ['free', 'similar'],
    ]);
  });

  test('breaks selection ties by cost, index, catalog order, then thinking order', () => {
    const result = recommendModels({
      anchor,
      models: [
        model('catalog-first', 'First', [reference('high', 81, 2), reference('low', 81, 2)]),
        model('catalog-second', 'Second', [reference('medium', 81, 2)]),
        model('cheaper', 'Third', [reference('medium', 81, 1)]),
      ],
    });

    expect(result[0]).toMatchObject({model: 'cheaper'});
    expect(result[1]).toMatchObject({model: 'catalog-first', thinking: 'low'});
  });
});
