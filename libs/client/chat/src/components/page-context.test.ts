import {pageContextLabel, suggestedPrompts} from './page-context.js';

describe('suggestedPrompts', () => {
  test('asks why a failed run failed, and summarizes any other run', () => {
    expect(suggestedPrompts({page: 'run', runId: 'run', status: 'failed'})).toEqual([
      'Why did this run fail?',
    ]);
    expect(suggestedPrompts({page: 'run', runId: 'run', status: 'succeeded'})).toEqual([
      'Summarize this run',
    ]);
  });

  test('chooses by page, and suggests nothing on settings', () => {
    expect(suggestedPrompts({page: 'runs'})).toEqual([
      'What failed recently?',
      'Which workflow can you start for me?',
    ]);
    expect(suggestedPrompts({page: 'workflows'})).toEqual([
      'What does each workflow do?',
      'Which workflow can you start for me?',
    ]);
    expect(suggestedPrompts({page: 'workflow', definitionId: 'definition'})).toContain(
      'Start this workflow',
    );
    expect(suggestedPrompts({page: 'project_settings', section: 'general'})).toEqual([]);
    expect(suggestedPrompts(undefined)).toEqual([]);
  });
});

describe('pageContextLabel', () => {
  test('names the run the way the page does', () => {
    expect(pageContextLabel({page: 'run', runId: 'run', runNumber: 214})).toBe('Viewing run #214');
    expect(pageContextLabel({page: 'job', runId: 'run', runNumber: 214, jobId: 'job'})).toBe(
      'Viewing a job in run #214',
    );
    expect(pageContextLabel({page: 'job', runId: 'run', jobId: 'job'})).toBe(
      'Viewing a job in a run',
    );
  });
});
