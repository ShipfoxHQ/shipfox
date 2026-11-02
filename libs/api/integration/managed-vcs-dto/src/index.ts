import {isUuid} from '@shipfox/regex';

export const MANAGED_VCS_PROVIDER = 'managed-vcs';
export type ManagedVcsProvider = typeof MANAGED_VCS_PROVIDER;

export const MANAGED_DEFAULT_BRANCH = 'main';

const REPOSITORY_ID_PREFIX = `${MANAGED_VCS_PROVIDER}:`;

export function isManagedRepositoryId(externalRepositoryId: string): boolean {
  return (
    externalRepositoryId.startsWith(REPOSITORY_ID_PREFIX) &&
    isUuid(externalRepositoryId.slice(REPOSITORY_ID_PREFIX.length))
  );
}
