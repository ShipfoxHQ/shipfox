import {validateTriggerEventsSearch} from './search.js';

describe('validateTriggerEventsSearch', () => {
  test('passes through a full valid search', () => {
    const search = validateTriggerEventsSearch({
      source: 'github',
      event: 'push',
      outcome: ['routed', 'failed'],
      from: '2026-06-01T00:00:00.000Z',
      to: '2026-06-22T00:00:00.000Z',
    });

    expect(search).toEqual({
      source: 'github',
      event: 'push',
      outcome: ['routed', 'failed'],
      from: '2026-06-01T00:00:00.000Z',
      to: '2026-06-22T00:00:00.000Z',
    });
  });

  test('returns an empty search for empty input', () => {
    expect(validateTriggerEventsSearch({})).toEqual({});
  });

  test('keeps a valid single-outcome filter', () => {
    expect(validateTriggerEventsSearch({outcome: ['discarded']}).outcome).toEqual(['discarded']);
  });

  test('drops an outcome array containing an unknown value', () => {
    expect(validateTriggerEventsSearch({outcome: ['routed', 'bogus']}).outcome).toBeUndefined();
  });

  test('drops a non-string source rather than throwing', () => {
    expect(validateTriggerEventsSearch({source: 123}).source).toBeUndefined();
  });

  test('drops a non-ISO date so it never reaches the read API', () => {
    const search = validateTriggerEventsSearch({from: '2026-06-01', to: 'yesterday'});

    expect(search.from).toBeUndefined();
    expect(search.to).toBeUndefined();
  });

  test('keeps a valid ISO datetime window', () => {
    const search = validateTriggerEventsSearch({
      from: '2026-06-01T00:00:00.000Z',
      to: '2026-06-22T23:59:59.999Z',
    });

    expect(search.from).toBe('2026-06-01T00:00:00.000Z');
    expect(search.to).toBe('2026-06-22T23:59:59.999Z');
  });
});
