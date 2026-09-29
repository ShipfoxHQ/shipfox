import type {PolicyNotice} from '@shipfox/policy-notice';

/**
 * Lets an application host choose which workspaces may receive installation-provisioned capacity.
 * The runners module passes candidate IDs in batches so host policy can apply its own entitlement
 * or tenancy rules without exposing those rules from this package.
 */
export interface WorkspacePlacementRules {
  allowsTemplate(templateLabels: readonly string[]): boolean;
  /** Called when every matching template is refused. */
  denial(requiredLabels: readonly string[]): PolicyNotice;
}

export interface InstallationPlacementPolicy {
  units(templateLabels: readonly string[]): number;
  holds: 'record' | 'require';
  /**
   * `default` prefers the fewest labels, then the template key. `smallest` prefers the fewest
   * units first, then the default order.
   */
  templateOrder: 'default' | 'smallest';
  /**
   * Rules per workspace. A missing entry means no rules. A thrown error skips these workspaces
   * for this poll.
   */
  resolve?(workspaceIds: readonly string[]): Promise<ReadonlyMap<string, WorkspacePlacementRules>>;
}

export interface InstallationProvisioningPolicy {
  filterEligibleWorkspaceIds(workspaceIds: readonly string[]): Promise<ReadonlySet<string>>;
  placement?: InstallationPlacementPolicy;
}

export interface CreateRunnersModuleOptions {
  installationProvisioning?: {
    policy: InstallationProvisioningPolicy;
  };
}
