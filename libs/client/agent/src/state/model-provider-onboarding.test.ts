import {
  dismissModelProviderOnboarding,
  isModelProviderOnboardingDismissed,
} from './model-provider-onboarding.js';

function createStorage(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial));
  return {
    getItem: vi.fn((key: string) => store.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      store.set(key, value);
    }),
  };
}

describe('model provider onboarding dismissed state', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test('round-trips dismissed workspaces through localStorage', () => {
    const localStorage = createStorage();
    vi.stubGlobal('window', {localStorage});

    dismissModelProviderOnboarding('workspace-1');

    expect(isModelProviderOnboardingDismissed('workspace-1')).toBe(true);
    expect(isModelProviderOnboardingDismissed('workspace-2')).toBe(false);
  });

  test('keeps dismissed state isolated per workspace', () => {
    const localStorage = createStorage({
      'shipfox.modelProviderOnboardingDismissed': JSON.stringify({'workspace-1': true}),
    });
    vi.stubGlobal('window', {localStorage});

    expect(isModelProviderOnboardingDismissed('workspace-1')).toBe(true);
    expect(isModelProviderOnboardingDismissed('workspace-2')).toBe(false);
  });

  test('is safe without window', () => {
    expect(isModelProviderOnboardingDismissed('workspace-1')).toBe(false);

    expect(() => dismissModelProviderOnboarding('workspace-1')).not.toThrow();
  });

  test('treats corrupt JSON as empty state', () => {
    const localStorage = createStorage({
      'shipfox.modelProviderOnboardingDismissed': '{',
    });
    vi.stubGlobal('window', {localStorage});

    expect(isModelProviderOnboardingDismissed('workspace-1')).toBe(false);
  });
});
