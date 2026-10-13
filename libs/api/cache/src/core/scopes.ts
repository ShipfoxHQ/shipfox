import {ReservedScopeError} from './errors.js';

export interface RunOrigin {
  origin: 'synced' | 'dev';
  initiatedByUserId: string | null;
}

/**
 * Maps the scopes an author writes to the scopes stored for this run. A dev run saves into a
 * sandbox of its starter and reads that sandbox before the shared scope, so it can never change
 * what a synced run restores.
 */
export interface ScopeView {
  /** Stored scopes to read for an authored scope, in lookup order. */
  readScopes(scope: string): string[];
  /** The stored scope a save of an authored scope lands in. */
  writeScope(scope: string): string;
}

export function assertScopeNotReserved(scope: string): void {
  if (scope === 'dev' || scope.startsWith('dev/')) throw new ReservedScopeError(scope);
}

const SHARED_SANDBOX_OWNER = 'shared';
const DEV_SANDBOX_PATTERN = /^dev\/(?<owner>[^/]+)\/(?<scope>.+)$/;

export function createScopeView(origin: RunOrigin): ScopeView {
  if (origin.origin === 'synced') {
    return {readScopes: (scope) => [scope], writeScope: (scope) => scope};
  }
  const sandbox = `dev/${origin.initiatedByUserId ?? SHARED_SANDBOX_OWNER}`;
  return {
    readScopes: (scope) => [`${sandbox}/${scope}`, scope],
    writeScope: (scope) => `${sandbox}/${scope}`,
  };
}

export interface DevSandbox {
  /** The member whose dev runs saved here, or `null` for dev runs with no recorded member. */
  userId: string | null;
  /** The scope as the author wrote it. */
  scope: string;
}

/** Reads a stored scope back into its parts. A scope that is not a sandbox answers `null`. */
export function parseDevSandbox(storedScope: string): DevSandbox | null {
  const match = DEV_SANDBOX_PATTERN.exec(storedScope);
  if (!match?.groups) return null;
  const {owner, scope} = match.groups;
  if (owner === undefined || scope === undefined) return null;
  return {userId: owner === SHARED_SANDBOX_OWNER ? null : owner, scope};
}
