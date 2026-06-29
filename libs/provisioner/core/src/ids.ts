import {randomUUID} from 'node:crypto';

/**
 * Mint a fresh, never-reused id for one provisioned runner. The provisioner owns this
 * identity end to end: it binds the ephemeral registration token, names the resource,
 * and keys idempotent reporting and reconciliation. Uniqueness is all the control loop
 * needs, so a random UUID suffices.
 */
export function newProvisionedRunnerId(): string {
  return randomUUID();
}
