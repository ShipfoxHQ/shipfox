/**
 * Lets an application host choose which workspaces may receive installation-provisioned capacity.
 * The runners module passes candidate IDs in batches so host policy can apply its own entitlement
 * or tenancy rules without exposing those rules from this package.
 */
export interface InstallationProvisioningPolicy {
  filterEligibleWorkspaceIds(workspaceIds: readonly string[]): Promise<ReadonlySet<string>>;
}

export interface CreateRunnersModuleOptions {
  installationProvisioning?: {
    policy: InstallationProvisioningPolicy;
  };
}
