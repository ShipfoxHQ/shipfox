import {
  type RunsSearchState,
  sameSearch,
  sanitizeRunsSearch,
  serializeRunsSearch,
  toWorkflowRunFilters,
} from './project-runs-search.js';

const DEFINITION_ID = '55555555-5555-4555-8555-555555555555';

describe('project runs search helpers', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  test('sanitizes valid URL search values', () => {
    const search = {
      status: 'running',
      definition_id: DEFINITION_ID,
      trigger_source: 'manual',
      date: '7d',
    };

    const result = sanitizeRunsSearch(search);

    expect(result).toEqual({
      status: 'running',
      definitionId: DEFINITION_ID,
      triggerSource: 'manual',
      date: '7d',
    });
  });

  test('drops invalid URL search values back to defaults', () => {
    const search = {
      status: 'finished',
      definition_id: 'not-a-uuid',
      trigger_source: 'api',
      date: 'forever',
    };

    const result = sanitizeRunsSearch(search);

    expect(result).toEqual({date: 'all'});
  });

  test('serializes only active filters', () => {
    const search: RunsSearchState = {
      status: 'failed',
      definitionId: DEFINITION_ID,
      triggerSource: 'cron',
      date: '24h',
    };

    const result = serializeRunsSearch(search);

    expect(result).toEqual({
      status: 'failed',
      definition_id: DEFINITION_ID,
      trigger_source: 'cron',
      date: '24h',
    });
  });

  test('compares current search to normalized search', () => {
    const current = {status: 'failed', date: undefined};
    const normalized = {status: 'failed'};

    const result = sameSearch(current, normalized);

    expect(result).toBe(true);
  });

  test('converts date presets into created window filters', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-07T12:00:00.000Z'));
    const search: RunsSearchState = {
      status: 'running',
      triggerSource: 'manual',
      definitionId: DEFINITION_ID,
      date: '24h',
    };

    const result = toWorkflowRunFilters(search);

    expect(result).toEqual({
      status: 'running',
      triggerSource: 'manual',
      definitionId: DEFINITION_ID,
      createdFrom: '2026-05-06T12:00:00.000Z',
    });
  });
});
