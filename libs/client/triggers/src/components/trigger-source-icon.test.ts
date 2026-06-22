import {getTriggerSourceIcon} from './trigger-source-icon.js';

describe('getTriggerSourceIcon', () => {
  it('maps the system sources manual and cron to their own icons', () => {
    expect(getTriggerSourceIcon('manual')).toBe('cursorLine');
    expect(getTriggerSourceIcon('cron')).toBe('timeLine');
  });

  it('delegates integration sources to the integration catalog', () => {
    expect(getTriggerSourceIcon('github')).toBe('github');
    expect(getTriggerSourceIcon('sentry')).toBe('sentry');
  });

  it('falls back for unknown or empty sources', () => {
    expect(getTriggerSourceIcon('gitlab')).toBe('componentLine');
    expect(getTriggerSourceIcon('')).toBe('componentLine');
    expect(getTriggerSourceIcon(null)).toBe('componentLine');
    expect(getTriggerSourceIcon(undefined)).toBe('componentLine');
  });
});
