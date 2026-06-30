import {
  dismissAgentProviderOnboarding,
  isAgentProviderOnboardingDismissed,
} from './agent-provider-onboarding.js';

function createStorage(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial));
  return {
    getItem: vi.fn((key: string) => store.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      store.set(key, value);
    }),
  };
}

describe('agent provider onboarding dismissed state', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test('round-trips dismissed workspaces through localStorage', () => {
    const localStorage = createStorage();
    vi.stubGlobal('window', {localStorage});

    dismissAgentProviderOnboarding('workspace-1');

    expect(isAgentProviderOnboardingDismissed('workspace-1')).toBe(true);
    expect(isAgentProviderOnboardingDismissed('workspace-2')).toBe(false);
  });

  test('keeps dismissed state isolated per workspace', () => {
    const localStorage = createStorage({
      'shipfox.agentProviderOnboardingDismissed': JSON.stringify({'workspace-1': true}),
    });
    vi.stubGlobal('window', {localStorage});

    expect(isAgentProviderOnboardingDismissed('workspace-1')).toBe(true);
    expect(isAgentProviderOnboardingDismissed('workspace-2')).toBe(false);
  });

  test('is safe without window', () => {
    expect(isAgentProviderOnboardingDismissed('workspace-1')).toBe(false);

    expect(() => dismissAgentProviderOnboarding('workspace-1')).not.toThrow();
  });

  test('treats corrupt JSON as empty state', () => {
    const localStorage = createStorage({
      'shipfox.agentProviderOnboardingDismissed': '{',
    });
    vi.stubGlobal('window', {localStorage});

    expect(isAgentProviderOnboardingDismissed('workspace-1')).toBe(false);
  });
});
