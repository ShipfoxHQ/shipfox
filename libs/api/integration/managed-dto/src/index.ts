import {isUuid} from '@shipfox/regex';

export const MANAGED_PROVIDER = 'managed';
export type ManagedProvider = typeof MANAGED_PROVIDER;

export const MANAGED_DEFAULT_BRANCH = 'main';

const REPOSITORY_ID_PREFIX = `${MANAGED_PROVIDER}:`;

export function isManagedRepositoryId(externalRepositoryId: string): boolean {
  return (
    externalRepositoryId.startsWith(REPOSITORY_ID_PREFIX) &&
    isUuid(externalRepositoryId.slice(REPOSITORY_ID_PREFIX.length))
  );
}
