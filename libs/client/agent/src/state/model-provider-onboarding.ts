import {createTypedBrowserStorage, localStorageOrUndefined} from '@shipfox/client-ui';

type DismissedMap = Record<string, true>;

const dismissedStorage = createTypedBrowserStorage(localStorageOrUndefined, {
  key: 'shipfox.modelProviderOnboardingDismissed',
  lifetime: 'persistent',
  principalScope: 'workspace',
  serialize: (dismissed: DismissedMap) => JSON.stringify(dismissed),
  parse: (raw) => {
    try {
      const parsed: unknown = JSON.parse(raw);
      return isDismissedMap(parsed) ? parsed : undefined;
    } catch {
      return undefined;
    }
  },
});

export function isModelProviderOnboardingDismissed(workspaceId: string): boolean {
  return Boolean(readDismissedMap()[workspaceId]);
}

export function dismissModelProviderOnboarding(workspaceId: string): void {
  const dismissed = readDismissedMap();
  dismissed[workspaceId] = true;
  dismissedStorage.write(dismissed);
}

function readDismissedMap(): DismissedMap {
  return dismissedStorage.read() ?? {};
}

function isDismissedMap(value: unknown): value is DismissedMap {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  return Object.values(value).every((entry) => entry === true);
}
