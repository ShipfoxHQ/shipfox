import type {RunnerInstanceReportEventDto} from '@shipfox/api-runners-dto';
import type {
  ProviderRunnerLaunch,
  ProviderRunnerTracker,
  ProvisionerClient,
  ProvisionerIdentity,
  ProvisionerTemplate,
} from '@shipfox/provisioner-core';
import {ProvisionerAuthenticationError} from '@shipfox/provisioner-core';
import {type Ec2Engine, Ec2EngineError, type Ec2InstanceView} from '#ec2-engine.js';
import {buildInstanceTags, parseInstanceIdentity} from '#instance-identity.js';
import type {Ec2TemplateSpec} from '#templates.js';

const MAX_REPORT_BATCH = 1000;
const MAX_REASON_LENGTH = 500;
const SPOT_INTERRUPTION_REASON =
  /spot|instance-terminated-by-price|instance-terminated-no-capacity/i;

type TrackerSeed = {
  providerRunnerId: string;
  templateKey: string;
  state: 'starting' | 'running';
};

type LocallyLaunchedRunner = {
  templateKey: string;
};

export interface Ec2Lifecycle {
  launch(launch: ProviderRunnerLaunch<Ec2TemplateSpec>): Promise<void>;
  observe(): Promise<void>;
  flush(): Promise<void>;
}

export interface Ec2LifecycleOptions {
  readonly engine: Ec2Engine;
  readonly client: ProvisionerClient;
  readonly identity: ProvisionerIdentity;
  readonly tracker: ProviderRunnerTracker;
  readonly templates: readonly ProvisionerTemplate<Ec2TemplateSpec>[];
  readonly providerKind: string;
  readonly now?: () => Date;
  readonly renderUserData?: (launch: ProviderRunnerLaunch<Ec2TemplateSpec>) => string;
}

interface Ec2LifecycleContext {
  readonly engine: Ec2Engine;
  readonly client: ProvisionerClient;
  readonly identity: ProvisionerIdentity;
  readonly tracker: ProviderRunnerTracker;
  readonly templatesByKey: ReadonlyMap<string, ProvisionerTemplate<Ec2TemplateSpec>>;
  readonly providerKind: string;
  readonly now: () => Date;
  readonly renderUserData?: (launch: ProviderRunnerLaunch<Ec2TemplateSpec>) => string;
  readonly locallyLaunched: Map<string, LocallyLaunchedRunner>;
  readonly pendingReports: RunnerInstanceReportEventDto[];
}

/**
 * Owns the EC2-facing half of the provisioner lifecycle. AWS observations replace
 * the local capacity view, except for newly launched instances that DescribeInstances
 * has not made visible yet.
 */
export function createEc2Lifecycle(options: Ec2LifecycleOptions): Ec2Lifecycle {
  const context: Ec2LifecycleContext = {
    engine: options.engine,
    client: options.client,
    identity: options.identity,
    tracker: options.tracker,
    templatesByKey: new Map(options.templates.map((template) => [template.key, template])),
    providerKind: options.providerKind,
    now: options.now ?? (() => new Date()),
    ...(options.renderUserData ? {renderUserData: options.renderUserData} : {}),
    locallyLaunched: new Map(),
    pendingReports: [],
  };

  return {
    launch: (launch) => launchRunner(context, launch),
    observe: () => observe(context),
    flush: () => flush(context),
  };
}

async function launchRunner(
  context: Ec2LifecycleContext,
  launch: ProviderRunnerLaunch<Ec2TemplateSpec>,
): Promise<void> {
  try {
    await attachProviderIdentity(context, launch);
    await reportEvents(context, [eventForLaunch(context, launch, 'starting')]);
    await context.engine.runInstance({
      clientToken: launch.providerRunnerId,
      tags: buildInstanceTags({launch, identity: context.identity}),
      ami: launch.template.spec.ami,
      instanceType: launch.template.spec.instanceType,
      market: launch.template.spec.market,
      spotMaxPrice: launch.template.spec.spotMaxPrice,
      subnetId: selectSubnet(launch),
      securityGroupIds: launch.template.spec.securityGroups,
      ...(launch.template.spec.iamInstanceProfile
        ? {iamInstanceProfile: launch.template.spec.iamInstanceProfile}
        : {}),
      associatePublicIp: launch.template.spec.associatePublicIp,
      rootVolumeGb: launch.template.spec.rootVolumeGb,
      rootDeviceName: launch.template.spec.rootDeviceName,
      ...(context.renderUserData ? {userData: context.renderUserData(launch)} : {}),
    });
    context.locallyLaunched.set(launch.providerRunnerId, {templateKey: launch.template.key});
  } catch (error) {
    await reportEvents(context, [eventForLaunch(context, launch, 'failed', errorReason(error))]);
    throw error;
  }
}

async function observe(context: Ec2LifecycleContext): Promise<void> {
  await reportEvents(context, []);
  const instances = await context.engine.listManaged(context.identity.id);
  const trackerRunners: TrackerSeed[] = [];
  const events: RunnerInstanceReportEventDto[] = [];
  const observedIds = new Set<string>();

  for (const instance of instances) {
    const identity = parseInstanceIdentity(instance);
    if (!identity.providerRunnerId) continue;
    observedIds.add(identity.providerRunnerId);
    context.locallyLaunched.delete(identity.providerRunnerId);

    const template = identity.templateKey
      ? context.templatesByKey.get(identity.templateKey)
      : undefined;
    const labels = identity.labels.length > 0 ? identity.labels : (template?.labels ?? []);
    if (labels.length === 0) continue;

    const mapped = mapInstanceState(instance);
    events.push(eventForInstance(context, instance, mapped.state, labels, mapped.reason));
    if ((mapped.state === 'starting' || mapped.state === 'running') && identity.templateKey) {
      trackerRunners.push({
        providerRunnerId: identity.providerRunnerId,
        templateKey: identity.templateKey,
        state: mapped.state,
      });
    }
  }

  // DescribeInstances is eventually consistent. Retaining a locally successful
  // launch until AWS returns it avoids turning that gap into a free capacity slot.
  for (const [providerRunnerId, launched] of context.locallyLaunched) {
    if (!observedIds.has(providerRunnerId)) {
      trackerRunners.push({providerRunnerId, templateKey: launched.templateKey, state: 'starting'});
    }
  }

  context.tracker.replaceAll(trackerRunners);
  await reportEvents(context, events);
}

async function attachProviderIdentity(
  context: Ec2LifecycleContext,
  launch: ProviderRunnerLaunch<Ec2TemplateSpec>,
): Promise<void> {
  const result = await context.client.attachRunnerInstanceProviderId(
    launch.runnerInstanceId,
    launch.providerRunnerId,
  );
  if (!result.attached) {
    throw new Error(
      `Provider identity was not attached for runner instance ${launch.runnerInstanceId}`,
    );
  }
}

async function reportEvents(
  context: Ec2LifecycleContext,
  events: readonly RunnerInstanceReportEventDto[],
): Promise<void> {
  const reports = [...context.pendingReports.splice(0), ...events];
  for (let index = 0; index < reports.length; index += MAX_REPORT_BATCH) {
    const batch = reports.slice(index, index + MAX_REPORT_BATCH);
    try {
      await context.client.reportRunnerInstances({events: batch});
    } catch (error) {
      if (error instanceof ProvisionerAuthenticationError) {
        context.pendingReports.push(...reports.slice(index));
        throw error;
      }
      if (responseStatus(error) === 400) continue;
      context.pendingReports.push(...reports.slice(index));
      return;
    }
  }
}

async function flush(context: Ec2LifecycleContext): Promise<void> {
  try {
    await reportEvents(context, []);
  } catch {
    // Shutdown must remain best-effort; the next process will re-observe AWS state.
  }
}

function eventForLaunch(
  context: Ec2LifecycleContext,
  launch: ProviderRunnerLaunch<Ec2TemplateSpec>,
  state: 'starting' | 'failed',
  reason?: string,
): RunnerInstanceReportEventDto {
  return {
    runner_instance_id: launch.runnerInstanceId,
    provider_runner_id: launch.providerRunnerId,
    ...(launch.reservationId ? {reservation_id: launch.reservationId} : {}),
    template_key: launch.template.key,
    labels: [...launch.template.labels],
    state,
    ...(reason ? {reason: truncateReason(reason)} : {}),
    reported_at: context.now().toISOString(),
    provider_kind: context.providerKind,
  };
}

function eventForInstance(
  context: Ec2LifecycleContext,
  instance: Ec2InstanceView,
  state: RunnerInstanceReportEventDto['state'],
  labels: readonly string[],
  reason?: string,
): RunnerInstanceReportEventDto {
  const identity = parseInstanceIdentity(instance);
  return {
    ...(identity.runnerInstanceId ? {runner_instance_id: identity.runnerInstanceId} : {}),
    provider_runner_id: identity.providerRunnerId,
    ...(identity.reservationId ? {reservation_id: identity.reservationId} : {}),
    ...(identity.templateKey ? {template_key: identity.templateKey} : {}),
    labels: [...labels],
    state,
    ...(reason ? {reason: truncateReason(reason)} : {}),
    reported_at: context.now().toISOString(),
    provider_kind: context.providerKind,
  };
}

function mapInstanceState(instance: Ec2InstanceView): {
  state: RunnerInstanceReportEventDto['state'];
  reason?: string;
} {
  switch (instance.state) {
    case 'pending':
      return {state: 'starting'};
    case 'running':
      return {state: 'running'};
    case 'shutting-down':
    case 'stopping':
      return {state: 'stopping'};
    case 'stopped':
    case 'terminated':
      return isSpotInterruption(instance)
        ? {state: 'failed', reason: 'spot-interruption'}
        : {state: 'terminated'};
    default:
      return {state: 'running', reason: `ec2-state-${instance.state}`};
  }
}

function isSpotInterruption(instance: Ec2InstanceView): boolean {
  return SPOT_INTERRUPTION_REASON.test(
    [instance.stateTransitionReason, instance.stateReasonCode, instance.stateReasonMessage]
      .filter((value): value is string => value !== undefined)
      .join(' '),
  );
}

function selectSubnet(launch: ProviderRunnerLaunch<Ec2TemplateSpec>): string {
  const subnets = launch.template.spec.subnets;
  const hash = [...launch.providerRunnerId].reduce(
    (sum, character) => sum + character.charCodeAt(0),
    0,
  );
  const subnet = subnets[hash % subnets.length] ?? subnets[0];
  if (!subnet) throw new Error(`Template ${launch.template.key} has no subnets.`);
  return subnet;
}

function errorReason(error: unknown): string {
  if (error instanceof Ec2EngineError) return error.reason;
  return error instanceof Error ? error.message : String(error);
}

function responseStatus(error: unknown): number | undefined {
  if (!(error instanceof Error)) return undefined;
  const response = (error as Error & {response?: {status?: unknown}}).response;
  return typeof response?.status === 'number' ? response.status : undefined;
}

function truncateReason(reason: string): string {
  return reason.slice(0, MAX_REASON_LENGTH);
}
