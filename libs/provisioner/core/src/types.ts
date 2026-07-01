import type {ProvisionerClient} from '#api-client.js';
import type {ProvisionedRunnerTracker} from '#tracker.js';

/**
 * A machine template the provisioner can start runners from. The control loop is
 * provider-agnostic and only reads the fields needed to match demand and respect
 * capacity; provider-specific details (a Docker image, a Kubernetes pod spec, an
 * EC2 launch template) live opaquely in `spec` and are read by the launcher.
 */
export interface ProvisionerTemplate<Spec = unknown> {
  /** Stable, unique key identifying the template within the provisioner config. */
  readonly key: string;
  /** Canonical labels a runner started from this template registers with. */
  readonly labels: readonly string[];
  /** Maximum runners the provisioner will keep alive concurrently for this template. */
  readonly maxConcurrency: number;
  /**
   * Selection cost; lower is preferred when several templates satisfy the same
   * reservation. Providers map this to whatever they optimize for (Docker uses
   * vCPU count, so generic demand lands on the cheapest box that can run it).
   */
  readonly cost: number;
  /** Provider-specific launch details, opaque to the control loop. */
  readonly spec: Spec;
}

/** Live counts of provisioned runners the provisioner is managing for one template. */
export interface TemplateCounts {
  readonly starting: number;
  readonly running: number;
}

/**
 * One runner the control loop has decided to start: a minted single-use
 * registration token plus the environment the runner container needs. The
 * registration token is a secret and must never be logged.
 */
export interface ProvisionedRunnerLaunch<Spec = unknown> {
  readonly provisionedRunnerId: string;
  readonly reservationId: string;
  readonly template: ProvisionerTemplate<Spec>;
  readonly registrationToken: string;
  readonly registrationTokenExpiresAt: string;
  /** Environment to inject into the runner process (carries the registration token). */
  readonly runnerEnv: Readonly<Record<string, string>>;
}

/** Starts one provisioned runner. The provider implementation owns the side effect. */
export type LaunchRunner<Spec = unknown> = (launch: ProvisionedRunnerLaunch<Spec>) => Promise<void>;

/** Tears down provider resources by provisioned runner id when the backend requests it. */
export type TerminateRunners = (provisionedRunnerIds: readonly string[]) => Promise<void>;

export interface ProvisionerIdentity {
  readonly id: string;
  readonly workspaceId: string;
}

export interface ProvisionerRuntime {
  readonly client: ProvisionerClient;
  readonly identity: ProvisionerIdentity;
  readonly tracker: ProvisionedRunnerTracker;
}

/**
 * The provider plug-in the control loop drives. A provider supplies its templates
 * (parsed and validated from local config) and a launcher that actually starts a
 * runner from a minted registration token.
 */
export interface ProvisionerAdapter<Spec = unknown> {
  loadTemplates(): Promise<readonly ProvisionerTemplate<Spec>[]>;
  readonly launch: LaunchRunner<Spec>;
  readonly terminate?: TerminateRunners;
  onStart?(runtime: ProvisionerRuntime): Promise<void>;
  onTick?(): Promise<void>;
  onStop?(): Promise<void>;
}
