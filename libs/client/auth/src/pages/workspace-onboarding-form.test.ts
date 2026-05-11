import {parseWorkspaceOnboardingForm} from './workspace-onboarding-form.js';

describe('parseWorkspaceOnboardingForm', () => {
  test('trims workspace names', () => {
    const result = parseWorkspaceOnboardingForm({name: '  Acme  '});

    expect(result).toEqual({
      ok: true,
      body: {name: 'Acme'},
    });
  });

  test('returns field errors for blank names', () => {
    const result = parseWorkspaceOnboardingForm({name: '   '});

    expect(result).toEqual({
      ok: false,
      fieldErrors: {
        name: 'String must contain at least 1 character(s)',
      },
    });
  });
});
