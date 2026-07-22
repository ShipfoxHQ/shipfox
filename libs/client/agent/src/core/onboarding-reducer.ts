import type {HarnessId, SupportedProvider} from './models.js';

export type OnboardingState =
  | {readonly step: 'choose-harness'}
  | {readonly step: 'choose-provider'; readonly harnessId: HarnessId}
  | {
      readonly step: 'configure-provider';
      readonly harnessId: HarnessId;
      readonly provider: SupportedProvider;
      readonly error?: string | undefined;
    }
  | {
      readonly step: 'saving-default-harness';
      readonly harnessId: HarnessId;
      readonly provider: SupportedProvider;
      readonly error?: string | undefined;
    };

export type OnboardingAction =
  | {readonly type: 'harness-selected'; readonly harnessId: HarnessId}
  | {readonly type: 'back'}
  | {readonly type: 'provider-selected'; readonly provider: SupportedProvider}
  | {readonly type: 'provider-saved'}
  | {readonly type: 'default-harness-failed'; readonly message: string}
  | {readonly type: 'default-harness-saved'};

export const initialOnboardingState: OnboardingState = {step: 'choose-harness'};

function goBack(state: OnboardingState): OnboardingState {
  switch (state.step) {
    case 'choose-harness':
      return state;
    case 'choose-provider':
      return initialOnboardingState;
    case 'configure-provider':
      return {step: 'choose-provider', harnessId: state.harnessId};
    case 'saving-default-harness':
      return {step: 'configure-provider', harnessId: state.harnessId, provider: state.provider};
  }
}

export function onboardingReducer(
  state: OnboardingState,
  action: OnboardingAction,
): OnboardingState {
  switch (action.type) {
    case 'harness-selected':
      return {step: 'choose-provider', harnessId: action.harnessId};
    case 'back':
      return goBack(state);
    case 'provider-selected':
      return state.step === 'choose-provider'
        ? {step: 'configure-provider', harnessId: state.harnessId, provider: action.provider}
        : state;
    case 'provider-saved':
      return state.step === 'configure-provider'
        ? {step: 'saving-default-harness', harnessId: state.harnessId, provider: state.provider}
        : state;
    case 'default-harness-failed':
      return state.step === 'saving-default-harness' ? {...state, error: action.message} : state;
    case 'default-harness-saved':
      return initialOnboardingState;
  }
}
