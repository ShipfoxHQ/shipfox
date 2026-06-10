import {normalizeSentryIssueAction} from './webhook.js';

describe('normalizeSentryIssueAction', () => {
  test('rewrites a legacy "ignored" action to "archived"', () => {
    const result = normalizeSentryIssueAction({action: 'ignored', data: {issue: {id: '1'}}});

    expect(result).toMatchObject({action: 'archived', data: {issue: {id: '1'}}});
  });

  test('leaves a known action untouched', () => {
    const result = normalizeSentryIssueAction({action: 'resolved'});

    expect(result).toMatchObject({action: 'resolved'});
  });

  test('passes through a non-object payload unchanged', () => {
    expect(normalizeSentryIssueAction(null)).toBeNull();
    expect(normalizeSentryIssueAction('nope')).toBe('nope');
  });
});
