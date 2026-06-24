import {workflowRun} from '#test/fixtures/workflow-run.js';
import {runMatchesSearch, runMatchesStatusFilter, runTriggerLabel} from './run-display.js';

describe('runTriggerLabel', () => {
  test('joins trigger source and event with a slash', () => {
    const label = runTriggerLabel(workflowRun({trigger_source: 'github', trigger_event: 'push'}));

    expect(label).toBe('github / push');
  });

  test('drops an empty trigger event so the label has no dangling separator', () => {
    const label = runTriggerLabel(workflowRun({trigger_source: 'manual', trigger_event: ''}));

    expect(label).toBe('manual');
  });

  test('yields an empty label when neither source nor event is set', () => {
    const label = runTriggerLabel(workflowRun({trigger_source: '', trigger_event: ''}));

    expect(label).toBe('');
  });
});

describe('runMatchesSearch', () => {
  test('matches every run on a blank query', () => {
    const matches = runMatchesSearch(workflowRun(), '   ');

    expect(matches).toBe(true);
  });

  test('matches case-insensitively across id, name, status, and trigger', () => {
    const run = workflowRun({
      id: 'ABCD1234-X',
      name: 'Deploy Production',
      status: 'running',
      trigger_source: 'github',
      trigger_event: 'push',
    });

    expect(runMatchesSearch(run, 'abcd1234-x')).toBe(true);
    expect(runMatchesSearch(run, 'deploy production')).toBe(true);
    expect(runMatchesSearch(run, 'RUNNING')).toBe(true);
    expect(runMatchesSearch(run, 'github / push')).toBe(true);
  });

  test('returns false when nothing in the run contains the query', () => {
    const matches = runMatchesSearch(workflowRun(), 'no-such-run');

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
