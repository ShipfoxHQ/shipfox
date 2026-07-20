import {config} from '#config.js';
import {hasActiveWorkspaceProvisionerCapability as hasActiveWorkspaceProvisionerCapabilityDb} from '#db/provisioner-capability-snapshots.js';

export function hasActiveWorkspaceProvisionerCapability(params: {
  workspaceId: string;
  requiredLabels: string[];
}): Promise<boolean> {
  return hasActiveWorkspaceProvisionerCapabilityDb({
    ...params,
    windowSeconds: config.PROVISIONER_ACTIVE_WINDOW_SECONDS,
  });
}
