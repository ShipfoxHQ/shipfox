import {shouldFillAtSite} from './fill.js';

describe('shouldFillAtSite', () => {
  it('fills server targets at the matching site', () => {
    const result = shouldFillAtSite('run-creation', 'run-creation');

    expect(result).toBe(true);
  });

  it('fills earlier server targets at later sites', () => {
    const result = shouldFillAtSite('run-creation', 'job-activation');

    expect(result).toBe(true);
  });

  it('does not fill later server targets at earlier sites', () => {
    const result = shouldFillAtSite('step-report', 'job-activation');

    expect(result).toBe(false);
  });

  it('does not fill runner targets at server sites', () => {
    const result = shouldFillAtSite('runner-fill', 'job-resolution');

    expect(result).toBe(false);
  });
});
