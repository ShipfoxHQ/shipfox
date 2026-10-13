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

export function createScopeView(origin: RunOrigin): ScopeView {
  if (origin.origin === 'synced') {
    return {readScopes: (scope) => [scope], writeScope: (scope) => scope};
  }
  const sandbox = `dev/${origin.initiatedByUserId ?? 'shared'}`;
  return {
    readScopes: (scope) => [`${sandbox}/${scope}`, scope],
    writeScope: (scope) => `${sandbox}/${scope}`,
  };
}
