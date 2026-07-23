import {
  type BrowserStorageKey,
  createTypedBrowserStorage,
  localStorageOrUndefined,
} from '@shipfox/client-ui';

const dismissedStorageKey = {
  key: 'shipfox.modelProviderOnboardingDismissed',
  lifetime: 'persistent',
  principalScope: 'workspace',
  serialize: (dismissed: boolean) => JSON.stringify(dismissed),
  parse: (raw) => {
    return raw === 'true' ? true : raw === 'false' ? false : undefined;
  },
} satisfies BrowserStorageKey<boolean>;

export function isModelProviderOnboardingDismissed(workspaceId: string): boolean {
  return dismissedStorage(workspaceId).read() === true;
}

export function dismissModelProviderOnboarding(workspaceId: string): void {
  dismissedStorage(workspaceId).write(true);
}

function dismissedStorage(workspaceId: string) {
  return createTypedBrowserStorage(localStorageOrUndefined, dismissedStorageKey, {workspaceId});
}
