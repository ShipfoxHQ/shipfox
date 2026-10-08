import {
  type BrowserStorage,
  type BrowserStorageKey,
  createTypedBrowserStorage,
  sessionStorageOrUndefined,
} from '@shipfox/client-ui';

/**
 * Where an install lands after its callback succeeds. A closed set, never a URL, so a crafted
 * link cannot turn the callback into an open redirect.
 */
export type InstallReturnTarget = 'settings' | 'home';

export const INSTALL_RETURN_TARGET_KEY = 'shipfox.integration-install.return-target';

/** Query parameter on an install route that carries the requested return target. */
export const INSTALL_RETURN_TARGET_PARAM = 'returnTo';

const DEFAULT_RETURN_TARGET: InstallReturnTarget = 'settings';

const installReturnTargetStorageKey = {
  key: INSTALL_RETURN_TARGET_KEY,
  lifetime: 'session',
  // A one-shot navigation hint read on an OAuth callback before workspace hydration completes.
  principalScope: 'global',
  serialize: (target: InstallReturnTarget) => target,
  parse: (value: string) => (isInstallReturnTarget(value) ? value : undefined),
} satisfies BrowserStorageKey<InstallReturnTarget>;

export function isInstallReturnTarget(value: unknown): value is InstallReturnTarget {
  return value === 'settings' || value === 'home';
}

export function parseInstallReturnTarget(search: Record<string, unknown>): InstallReturnTarget {
  const value = search[INSTALL_RETURN_TARGET_PARAM];
  return isInstallReturnTarget(value) ? value : DEFAULT_RETURN_TARGET;
}

/**
 * Overwrites any previous value, so a target set by one install can never reach a later
 * install that did not ask for it.
 */
export function saveInstallReturnTarget(
  storage: BrowserStorage | undefined,
  target: InstallReturnTarget,
): void {
  installReturnTargetStorage(storage).write(target);
}

/** Reads the stored target and clears it. A missing or unknown value is `settings`. */
export function consumeInstallReturnTarget(
  storage: BrowserStorage | undefined = sessionStorageOrUndefined(),
): InstallReturnTarget {
  try {
    const typedStorage = installReturnTargetStorage(storage);
    const target = typedStorage.read();
    typedStorage.remove();
    return target ?? DEFAULT_RETURN_TARGET;
  } catch {
    // Storage can be disabled; the default destination is always safe.
    return DEFAULT_RETURN_TARGET;
  }
}

/** Reads and clears the stored target, then returns the navigation for a finished install. */
export function consumeInstallReturnLocation(workspaceSlug: string) {
  const params = {workspaceSlug};
  if (consumeInstallReturnTarget() === 'home') {
    return {to: '/w/$workspaceSlug', params, replace: true} as const;
  }
  return {to: '/w/$workspaceSlug/settings/integrations', params, replace: true} as const;
}

function installReturnTargetStorage(storage: BrowserStorage | undefined) {
  return createTypedBrowserStorage(() => storage, installReturnTargetStorageKey);
}
