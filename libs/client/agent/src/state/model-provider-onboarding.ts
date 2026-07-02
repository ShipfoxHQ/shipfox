const MODEL_PROVIDER_ONBOARDING_STORAGE_KEY = 'shipfox.modelProviderOnboardingDismissed';

type DismissedMap = Record<string, true>;

export function isModelProviderOnboardingDismissed(workspaceId: string): boolean {
  return Boolean(readDismissedMap()[workspaceId]);
}

export function dismissModelProviderOnboarding(workspaceId: string): void {
  if (typeof window === 'undefined') return;

  const dismissed = readDismissedMap();
  dismissed[workspaceId] = true;
  window.localStorage.setItem(MODEL_PROVIDER_ONBOARDING_STORAGE_KEY, JSON.stringify(dismissed));
}

function readDismissedMap(): DismissedMap {
  if (typeof window === 'undefined') return {};

  try {
    const raw = window.localStorage.getItem(MODEL_PROVIDER_ONBOARDING_STORAGE_KEY);
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
