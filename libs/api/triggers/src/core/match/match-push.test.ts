import {matchPushBranch} from './match-push.js';

describe('matchPushBranch', () => {
  test('matches any branch when on is undefined', () => {
    const result = matchPushBranch('feature/x', undefined);

    expect(result).toBe(true);
  });

  test('matches when on is a single string equal to ref', () => {
    const result = matchPushBranch('main', 'main');

    expect(result).toBe(true);
  });

  test('does not match when on is a single string different from ref', () => {
    const result = matchPushBranch('feature/x', 'main');

    expect(result).toBe(false);
  });

  test('matches when on is an array containing the ref', () => {
    const result = matchPushBranch('develop', ['main', 'develop']);

    expect(result).toBe(true);
  });

  test('does not match when on is an array that does not contain the ref', () => {
    const result = matchPushBranch('feature/x', ['main', 'develop']);

    expect(result).toBe(false);
  });
});
