import type {ManagedModelLock, ManagedModelProvider} from '@shipfox/api-agent-dto';
import {logger} from '@shipfox/node-opentelemetry';

const NO_LOCKS: ReadonlyMap<string, ManagedModelLock> = new Map();

/**
 * Locked managed models for one workspace, for display and validation.
 *
 * Locks are advisory here, so an availability failure shows no locks instead of failing the read.
 * Run time still enforces the lock.
 */
export async function getManagedModelLocks(
  managedProvider: ManagedModelProvider | undefined,
  workspaceId: string,
): Promise<ReadonlyMap<string, ManagedModelLock>> {
  if (managedProvider?.availability === undefined) return NO_LOCKS;
  try {
    return await managedProvider.availability({workspaceId});
  } catch (error) {
    logger().warn(
      {err: error, workspaceId, managedProviderId: managedProvider.id},
      'Managed model availability failed, showing no locked models',
    );
    return NO_LOCKS;
  }
}
