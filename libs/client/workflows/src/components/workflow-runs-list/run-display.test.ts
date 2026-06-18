import type {RunDto} from '@shipfox/api-workflows-dto';
import {runMatchesSearch, runMatchesStatusFilter, runTriggerLabel} from './run-display.js';

function runDto(overrides: Partial<RunDto> = {}): RunDto {
  return {
    id: 'abcd1234-5678-4abc-8def-000000000000',
    project_id: '44444444-4444-4444-8444-444444444444',
    definition_id: '55555555-5555-4555-8555-555555555555',
    name: 'Deploy production',
    status: 'running',
    trigger_source: 'github',
    trigger_event: 'push',
    trigger_payload: {},
    inputs: null,
    created_at: '2026-05-07T01:01:00.000Z',
    updated_at: '2026-05-07T01:02:00.000Z',
    ...overrides,
  };
}

describe('runTriggerLabel', () => {
  test('joins trigger source and event with a slash', () => {
    const label = runTriggerLabel(runDto({trigger_source: 'github', trigger_event: 'push'}));

    expect(label).toBe('github / push');
  });

  test('drops an empty trigger event so the label has no dangling separator', () => {
    const label = runTriggerLabel(runDto({trigger_source: 'manual', trigger_event: ''}));

    expect(label).toBe('manual');
  });

  test('yields an empty label when neither source nor event is set', () => {
    const label = runTriggerLabel(runDto({trigger_source: '', trigger_event: ''}));

    expect(label).toBe('');
  });
});

describe('runMatchesSearch', () => {
  test('matches every run on a blank query', () => {
    const matches = runMatchesSearch(runDto(), '   ');

    expect(matches).toBe(true);
  });

  test('matches case-insensitively across id, name, status, and trigger', () => {
    const run = runDto({id: 'ABCD1234-X', name: 'Deploy Production', status: 'running'});

    expect(runMatchesSearch(run, 'abcd1234-x')).toBe(true);
    expect(runMatchesSearch(run, 'deploy production')).toBe(true);
    expect(runMatchesSearch(run, 'RUNNING')).toBe(true);
    expect(runMatchesSearch(run, 'github / push')).toBe(true);
  });

  test('returns false when nothing in the run contains the query', () => {
    const matches = runMatchesSearch(runDto(), 'no-such-run');

    expect(matches).toBe(false);
  });
});

describe('runMatchesStatusFilter', () => {
  test('matches every status when the filter is "all"', () => {
    expect(runMatchesStatusFilter('succeeded', 'all')).toBe(true);
    expect(runMatchesStatusFilter('cancelled', 'all')).toBe(true);
  });

  test('"failed" matches only failed runs', () => {
    expect(runMatchesStatusFilter('failed', 'failed')).toBe(true);
    expect(runMatchesStatusFilter('running', 'failed')).toBe(false);
    expect(runMatchesStatusFilter('succeeded', 'failed')).toBe(false);
  });

  test('"running" reads as in-progress and also covers pending runs', () => {
    expect(runMatchesStatusFilter('running', 'running')).toBe(true);
    expect(runMatchesStatusFilter('pending', 'running')).toBe(true);
    expect(runMatchesStatusFilter('succeeded', 'running')).toBe(false);
    expect(runMatchesStatusFilter('failed', 'running')).toBe(false);
    expect(runMatchesStatusFilter('cancelled', 'running')).toBe(false);
  });
});
