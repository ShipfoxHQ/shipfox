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
        name: 'Too small: expected string to have >=1 characters',
      },
    });
  });
});
