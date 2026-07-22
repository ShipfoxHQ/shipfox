import type {SupportedProvider} from './models.js';
import {initialOnboardingState, onboardingReducer} from './onboarding-reducer.js';

const provider: SupportedProvider = {
  kind: 'supported',
  id: 'anthropic',
  label: 'Anthropic',
  defaultModel: 'claude',
  credentialFields: [],
  models: [],
};

test('cannot select a provider before selecting a harness', () => {
  expect(onboardingReducer(initialOnboardingState, {type: 'provider-selected', provider})).toBe(
    initialOnboardingState,
  );
});

test('back steps back one screen at a time, keeping earlier selections', () => {
  const choosingProvider = onboardingReducer(initialOnboardingState, {
    type: 'harness-selected',
    harnessId: 'claude',
  });
  const configuring = onboardingReducer(choosingProvider, {type: 'provider-selected', provider});
  const saving = onboardingReducer(configuring, {type: 'provider-saved'});

  expect(onboardingReducer(saving, {type: 'back'})).toEqual(configuring);
  expect(onboardingReducer(configuring, {type: 'back'})).toEqual(choosingProvider);
  expect(onboardingReducer(choosingProvider, {type: 'back'})).toBe(initialOnboardingState);
  expect(onboardingReducer(initialOnboardingState, {type: 'back'})).toBe(initialOnboardingState);
});

test('keeps the selected provider while a default-harness request fails', () => {
  const choosingProvider = onboardingReducer(initialOnboardingState, {
    type: 'harness-selected',
    harnessId: 'claude',
  });
  const configuring = onboardingReducer(choosingProvider, {type: 'provider-selected', provider});
  const saving = onboardingReducer(configuring, {type: 'provider-saved'});

  expect(
    onboardingReducer(saving, {type: 'default-harness-failed', message: 'Try again.'}),
  ).toEqual({...saving, error: 'Try again.'});
});
