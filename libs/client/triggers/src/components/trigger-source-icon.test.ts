import {getTriggerSourceIcon} from './trigger-source-icon.js';

describe('getTriggerSourceIcon', () => {
  test('maps system sources to their own icons', () => {
    expect(getTriggerSourceIcon({provider: null, source: 'manual'})).toBe('cursorLine');
    expect(getTriggerSourceIcon({provider: null, source: 'cron'})).toBe('timeLine');
    expect(getTriggerSourceIcon({provider: 'shipfox', source: 'shipfox'})).toBe('shipfox');
  });

  test('resolves integration icons from provider while preserving slug sources', () => {
    const icon = getTriggerSourceIcon({provider: 'github', source: 'github_acme'});

    expect(icon).toBe('github');
  });

  test('falls back for unknown or empty providers', () => {
    expect(getTriggerSourceIcon({provider: 'gitlab', source: 'gitlab_acme'})).toBe('componentLine');
    expect(getTriggerSourceIcon({provider: '', source: 'github_acme'})).toBe('componentLine');
    expect(getTriggerSourceIcon({provider: null, source: 'github_acme'})).toBe('componentLine');
    expect(getTriggerSourceIcon({provider: undefined, source: 'github_acme'})).toBe(
      'componentLine',
    );
  });
});
