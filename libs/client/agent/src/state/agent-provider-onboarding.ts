const AGENT_PROVIDER_ONBOARDING_STORAGE_KEY = 'shipfox.agentProviderOnboardingDismissed';

type DismissedMap = Record<string, true>;

export function isAgentProviderOnboardingDismissed(workspaceId: string): boolean {
  return Boolean(readDismissedMap()[workspaceId]);
}

export function dismissAgentProviderOnboarding(workspaceId: string): void {
  if (typeof window === 'undefined') return;

  const dismissed = readDismissedMap();
  dismissed[workspaceId] = true;
  window.localStorage.setItem(AGENT_PROVIDER_ONBOARDING_STORAGE_KEY, JSON.stringify(dismissed));
}

function readDismissedMap(): DismissedMap {
  if (typeof window === 'undefined') return {};

  try {
    const raw = window.localStorage.getItem(AGENT_PROVIDER_ONBOARDING_STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!isDismissedMap(parsed)) return {};
    return parsed;
  } catch {
    return {};
  }
}

function isDismissedMap(value: unknown): value is DismissedMap {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  return Object.values(value).every((entry) => entry === true);
}
