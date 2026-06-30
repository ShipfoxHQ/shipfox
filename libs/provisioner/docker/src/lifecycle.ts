import type {ProvisionedRunnerReportEventDto} from '@shipfox/api-runners-dto';
import {logger} from '@shipfox/node-opentelemetry';
import type {
  ProvisionedRunnerLaunch,
  ProvisionedRunnerTracker,
  ProvisionerClient,
  ProvisionerIdentity,
  ProvisionerTemplate,
} from '@shipfox/provisioner-core';
import {buildContainerLabels, parseContainerIdentity} from '#container-identity.js';
import {type DockerContainerView, type DockerEngine, DockerEngineError} from '#docker-engine.js';
import {parseMemoryToBytes} from '#memory.js';
import type {DockerTemplateSpec} from '#templates.js';

const MAX_REPORT_BATCH = 1000;
const MAX_REASON_LENGTH = 500;

type TrackerSeed = {
  provisionedRunnerId: string;
  templateKey: string;
  state: 'starting' | 'running';
};

export interface DockerLifecycle {
  launch(launch: ProvisionedRunnerLaunch<DockerTemplateSpec>): Promise<void>;
  observe(): Promise<void>;
  reconcile(): Promise<void>;
  flush(): Promise<void>;
}

interface DockerLifecycleOptions {
  engine: DockerEngine;
  client: ProvisionerClient;
  identity: ProvisionerIdentity;
  tracker: ProvisionedRunnerTracker;
  templates: readonly ProvisionerTemplate<DockerTemplateSpec>[];
  now?: () => Date;
  registrationDeadlineMs: number;
  providerKind: string;
}

interface DockerLifecycleContext {
  readonly engine: DockerEngine;
  readonly client: ProvisionerClient;
  readonly identity: ProvisionerIdentity;
  readonly tracker: ProvisionedRunnerTracker;
  readonly templatesByKey: ReadonlyMap<string, ProvisionerTemplate<DockerTemplateSpec>>;
  readonly now: () => Date;
  readonly registrationDeadlineMs: number;
  readonly providerKind: string;
  readonly knownLiveIds: Set<string>;
  readonly knownTemplateKeys: Map<string, string>;
}

interface ObservationPlan {
  readonly trackerRunners: TrackerSeed[];
  readonly liveEvents: ProvisionedRunnerReportEventDto[];
  readonly terminalActions: TerminalAction[];
}

interface TerminalAction {
  readonly event: ProvisionedRunnerReportEventDto;
  readonly remove?: string;
  readonly killAndRemove?: string;
}

type LiveContainerState = {
  state: 'starting' | 'running';
  reason?: string;
};
type ParsedContainerIdentity = ReturnType<typeof parseContainerIdentity>;

export function createDockerLifecycle(args: DockerLifecycleOptions): DockerLifecycle {
  const now = args.now ?? (() => new Date());
  const context: DockerLifecycleContext = {
    engine: args.engine,
    client: args.client,
    identity: args.identity,
    tracker: args.tracker,
    templatesByKey: new Map(args.templates.map((template) => [template.key, template])),
    now,
    registrationDeadlineMs: args.registrationDeadlineMs,
    providerKind: args.providerKind,
    knownLiveIds: new Set<string>(),
    knownTemplateKeys: new Map<string, string>(),
  };

  return {
    launch: (runner) => launch(context, runner),
    observe: () => observe(context),
    reconcile: () => observe(context),
    flush: () => Promise.resolve(),
  };
}

async function launch(
  context: DockerLifecycleContext,
  runner: ProvisionedRunnerLaunch<DockerTemplateSpec>,
): Promise<void> {
  const labels = buildContainerLabels({launch: runner, identity: context.identity});
  await reportEvents(context, [
    {
      provisioned_runner_id: runner.provisionedRunnerId,
      reservation_id: runner.reservationId,
      template_key: runner.template.key,
      labels: [...runner.template.labels],
      state: 'starting',
      reported_at: context.now().toISOString(),
      provider_kind: context.providerKind,
    },
  ]);

  try {
    await context.engine.createAndStart({
      name: runner.provisionedRunnerId,
      image: runner.template.spec.image,
      env: runner.runnerEnv,
      labels,
      nanoCpus: Math.round(runner.template.spec.cpu * 1_000_000_000),
      memoryBytes: parseMemoryToBytes(runner.template.spec.memory),
    });
    context.knownLiveIds.add(runner.provisionedRunnerId);
    context.knownTemplateKeys.set(runner.provisionedRunnerId, runner.template.key);
  } catch (error) {
    await reportEvents(context, [
      {
        provisioned_runner_id: runner.provisionedRunnerId,
        reservation_id: runner.reservationId,
        template_key: runner.template.key,
        labels: [...runner.template.labels],
        state: 'failed',
        reason: truncateReason(errorReason(error)),
        reported_at: context.now().toISOString(),
        provider_kind: context.providerKind,
      },
    ]);
    throw error;
  }
}

async function observe(context: DockerLifecycleContext): Promise<void> {
  const containers = await context.engine.listManaged(context.identity.id);
  const plan = buildObservationPlan(context, containers);

  context.tracker.replaceAll(plan.trackerRunners);
  if (plan.liveEvents.length > 0) await reportEvents(context, plan.liveEvents);
  await applyTerminalActions(context, plan.terminalActions);
}

function buildObservationPlan(
  context: DockerLifecycleContext,
  containers: readonly DockerContainerView[],
): ObservationPlan {
  const listedIds = new Set<string>();
  const plan: ObservationPlan = {
    trackerRunners: [],
    liveEvents: [],
    terminalActions: [],
  };

  for (const container of containers) {
    recordContainerObservation(context, plan, listedIds, container);
  }
  synthesizeVanishedContainers(context, plan, listedIds);

  return plan;
}

function recordContainerObservation(
  context: DockerLifecycleContext,
  plan: ObservationPlan,
  listedIds: Set<string>,
  container: DockerContainerView,
): void {
  const parsed = parseContainerIdentity(container);
  listedIds.add(parsed.provisionedRunnerId);
  const labels = labelsFor(context, parsed.templateKey, parsed.labels);
  if (labels.length === 0) {
    logger().warn(
      {provisionedRunnerId: parsed.provisionedRunnerId},
      'Skipping provisioned runner report because labels are unavailable',
    );
    return;
  }

  if (
    container.state === 'created' &&
    isPastDeadline(container.createdAt, context.now(), context.registrationDeadlineMs)
  ) {
    plan.terminalActions.push({
      event: eventFor(container, 'terminated', labels, context.providerKind, context.now()),
      killAndRemove: container.name,
    });
    return;
  }

  const mapped = mapContainerState(container);
  if (mapped.state === 'starting' || mapped.state === 'running') {
    const liveState: LiveContainerState = {
      state: mapped.state,
      ...(mapped.reason ? {reason: mapped.reason} : {}),
    };
    recordLiveContainer(context, plan, container, parsed, labels, liveState);
    return;
  }

  plan.terminalActions.push({
    event: eventFor(
      container,
      mapped.state,
      labels,
      context.providerKind,
      context.now(),
      mapped.reason,
    ),
    remove: container.name,
  });
}

function recordLiveContainer(
  context: DockerLifecycleContext,
  plan: ObservationPlan,
  container: DockerContainerView,
  parsed: ParsedContainerIdentity,
  labels: readonly string[],
  mapped: LiveContainerState,
): void {
  context.knownLiveIds.add(parsed.provisionedRunnerId);
  if (parsed.templateKey) {
    context.knownTemplateKeys.set(parsed.provisionedRunnerId, parsed.templateKey);
  }
  plan.liveEvents.push(
    eventFor(container, mapped.state, labels, context.providerKind, context.now(), mapped.reason),
  );
  if (parsed.templateKey) {
    plan.trackerRunners.push({
      provisionedRunnerId: parsed.provisionedRunnerId,
      templateKey: parsed.templateKey,
      state: mapped.state,
    });
  }
}

function synthesizeVanishedContainers(
  context: DockerLifecycleContext,
  plan: ObservationPlan,
  listedIds: ReadonlySet<string>,
): void {
  for (const provisionedRunnerId of [...context.knownLiveIds]) {
    if (listedIds.has(provisionedRunnerId)) continue;
    context.knownLiveIds.delete(provisionedRunnerId);
    const templateKey = context.knownTemplateKeys.get(provisionedRunnerId);
    context.knownTemplateKeys.delete(provisionedRunnerId);
    const template = templateKey ? context.templatesByKey.get(templateKey) : undefined;
    if (!template) continue;
    plan.terminalActions.push({
      event: {
        provisioned_runner_id: provisionedRunnerId,
        template_key: template.key,
        labels: [...template.labels],
        state: 'terminated',
        reported_at: context.now().toISOString(),
        provider_kind: context.providerKind,
      },
    });
  }
}

async function applyTerminalActions(
  context: DockerLifecycleContext,
  actions: readonly TerminalAction[],
): Promise<void> {
  for (const action of actions) {
    await reportEvents(context, [action.event]);
    if (action.killAndRemove) await context.engine.killAndRemove(action.killAndRemove);
    if (action.remove) await context.engine.remove(action.remove);
    context.knownLiveIds.delete(action.event.provisioned_runner_id);
    context.knownTemplateKeys.delete(action.event.provisioned_runner_id);
    context.tracker.remove(action.event.provisioned_runner_id);
  }
}

async function reportEvents(
  context: DockerLifecycleContext,
  events: readonly ProvisionedRunnerReportEventDto[],
): Promise<void> {
  for (const batch of chunk(events, MAX_REPORT_BATCH)) {
    await context.client.reportProvisionedRunners({events: batch});
  }
}

function labelsFor(
  context: DockerLifecycleContext,
  templateKey: string | undefined,
  labels: readonly string[],
): readonly string[] {
  if (labels.length > 0) return labels;
  return templateKey ? (context.templatesByKey.get(templateKey)?.labels ?? []) : [];
}

function eventFor(
  container: DockerContainerView,
  state: ProvisionedRunnerReportEventDto['state'],
  labels: readonly string[],
  providerKind: string,
  reportedAt: Date,
  reason?: string,
): ProvisionedRunnerReportEventDto {
  const parsed = parseContainerIdentity(container);
  return {
    provisioned_runner_id: parsed.provisionedRunnerId,
    ...(parsed.reservationId ? {reservation_id: parsed.reservationId} : {}),
    ...(parsed.templateKey ? {template_key: parsed.templateKey} : {}),
    labels: [...labels],
    state,
    ...(reason ? {reason: truncateReason(reason)} : {}),
    reported_at: reportedAt.toISOString(),
    provider_kind: providerKind,
  };
}

function mapContainerState(container: DockerContainerView): {
  state: ProvisionedRunnerReportEventDto['state'];
  reason?: string;
} {
  switch (container.state) {
    case 'created':
      return {state: 'starting'};
    case 'running':
    case 'paused':
    case 'restarting':
      return {state: 'running'};
    case 'exited':
      if (container.oomKilled) return {state: 'failed', reason: 'oom'};
      return container.exitCode === 0
        ? {state: 'stopped'}
        : {state: 'failed', reason: `exit-code-${container.exitCode ?? 'unknown'}`};
    case 'dead':
    case 'removing':
      return {state: 'terminated'};
    default:
      return {state: 'running', reason: `docker-state-${container.state}`};
  }
}

function isPastDeadline(createdAt: Date, now: Date, deadlineMs: number): boolean {
  return now.getTime() - createdAt.getTime() > deadlineMs;
}

function errorReason(error: unknown): string {
  if (error instanceof DockerEngineError) return error.reason;
  return error instanceof Error ? error.message : String(error);
}

function truncateReason(reason: string): string {
  return reason.slice(0, MAX_REASON_LENGTH);
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    batches.push(items.slice(index, index + size));
  }
  return batches;
}
