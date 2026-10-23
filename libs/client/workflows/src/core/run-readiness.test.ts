import type {RunIssue} from './run-issue-copy.js';
import {runIssueEffect, summarizeNeedsSetup} from './run-readiness.js';

const failsJob: RunIssue = {
  kind: 'secret-missing',
  key: 'TOKEN',
  locations: [],
  effect: 'fails-job',
};
const blocksStart: RunIssue = {
  kind: 'variable-missing',
  key: 'FLAG',
  locations: [],
  effect: 'blocks-start',
};

describe('summarizeNeedsSetup', () => {
  test('returns null without issues', () => {
    expect(summarizeNeedsSetup([])).toBeNull();
  });

  test('flags a blocking issue among others', () => {
    expect(summarizeNeedsSetup([failsJob, blocksStart])).toEqual({count: 2, blocksStart: true});
  });

  test('is not blocking when every issue fails a job later', () => {
    expect(summarizeNeedsSetup([failsJob])).toEqual({count: 1, blocksStart: false});
  });
});

describe('runIssueEffect', () => {
  test('reads the server effect', () => {
    expect(runIssueEffect(failsJob)).toBe('fails-job');
    expect(runIssueEffect(blocksStart)).toBe('blocks-start');
  });

  test('derives the effect of trigger-scoped issues', () => {
    expect(
      runIssueEffect({kind: 'trigger-secret-missing', key: 'K', trigger: {source: 'cron'}}),
    ).toBe('blocks-start');
    expect(
      runIssueEffect({
        kind: 'secret-input-unmapped',
        key: 'K',
        trigger: {source: 'cron'},
        locations: [],
      }),
    ).toBe('fails-job');
  });
});
