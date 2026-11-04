import type {ActiveRun} from './conversation.js';
import {jobProgressLabel, runLabel, runResultStatus, splitActiveRuns} from './runs.js';

function activeRun(number: number): ActiveRun {
  return {
    runId: `run-${number}`,
    number,
    name: 'implement',
    attempt: 1,
    status: 'running',
    startedAt: undefined,
    jobsFinished: 0,
    jobsTotal: 0,
  };
}

describe('runResultStatus', () => {
  test('reads a settled run as listening, and an ended one as its status', () => {
    expect(runResultStatus({status: 'settled'})).toBe('listening');
    expect(runResultStatus({status: 'failed'})).toBe('failed');
    expect(runResultStatus({status: 'something-new'})).toBeUndefined();
  });
});

describe('runLabel', () => {
  test('names a run by its name and number', () => {
    expect(runLabel({name: 'implement', number: 214})).toBe('implement #214');
    expect(runLabel({name: '', number: 214})).toBe('Run #214');
    expect(runLabel({})).toBe('Run');
  });
});

describe('splitActiveRuns', () => {
  test('shows three runs and collapses the rest', () => {
    const runs = [1, 2, 3, 4, 5].map(activeRun);

    const {shown, hidden} = splitActiveRuns(runs);

    expect(shown.map((run) => run.number)).toEqual([1, 2, 3]);
    expect(hidden.map((run) => run.number)).toEqual([4, 5]);
  });

  test('collapses nothing at three or fewer', () => {
    expect(splitActiveRuns([1, 2, 3].map(activeRun)).hidden).toEqual([]);
  });
});

describe('jobProgressLabel', () => {
  test('counts finished jobs, and says nothing before the attempt has jobs', () => {
    expect(jobProgressLabel({jobsFinished: 2, jobsTotal: 5})).toBe('2 of 5 jobs finished');
    expect(jobProgressLabel({jobsFinished: 0, jobsTotal: 1})).toBe('0 of 1 job finished');
    expect(jobProgressLabel({jobsFinished: 0, jobsTotal: 0})).toBeUndefined();
  });
});
