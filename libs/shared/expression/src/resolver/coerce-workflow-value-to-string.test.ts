import {coerceWorkflowValueToString} from './coerce-workflow-value-to-string.js';

describe('coerceWorkflowValueToString', () => {
  it.each([
    ['string', 'deploy main', 'deploy main'],
    ['bigint int', 42n, '42'],
    ['double', 3.14, '3.14'],
    ['boolean true', true, 'true'],
    ['boolean false', false, 'false'],
    ['null', null, ''],
    ['undefined', undefined, ''],
    ['date', new Date('2026-01-01T00:00:00.000Z'), '2026-01-01T00:00:00.000Z'],
    ['list', ['bug', 'p1'], '["bug","p1"]'],
    ['object', {conclusion: 'success', attempts: 2}, '{"conclusion":"success","attempts":2}'],
    [
      'nested object',
      {pull_request: {title: 'Fix auth', labels: ['bug']}},
      '{"pull_request":{"title":"Fix auth","labels":["bug"]}}',
    ],
    ['empty string', '', ''],
    ['safe bigint in list', [42n], '[42]'],
    ['unsafe bigint in list', [9007199254740993n], '["9007199254740993"]'],
  ])('coerces %s', (_name, value, expected) => {
    const result = coerceWorkflowValueToString(value);

    expect(result).toBe(expected);
  });
});
