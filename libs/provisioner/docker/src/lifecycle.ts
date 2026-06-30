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

export function createDockerLifecycle(args: {
  engine: DockerEngine;
  client: ProvisionerClient;
  identity: ProvisionerIdentity;
  tracker: ProvisionedRunnerTracker;
  templates: readonly ProvisionerTemplate<DockerTemplateSpec>[];
  now?: () => Date;
  registrationDeadlineMs: number;
  providerKind: string;
}): DockerLifecycle {
  const now = args.now ?? (() => new Date());
  const templatesByKey = new Map(args.templates.map((template) => [template.key, template]));
  const knownLiveIds = new Set<string>();
  const knownTemplateKeys = new Map<string, string>();

  async function report(events: ProvisionedRunnerReportEventDto[]): Promise<void> {
    for (const batch of chunk(events, MAX_REPORT_BATCH)) {
      await args.client.reportProvisionedRunners({events: batch});
    }
  }

  async function observe(): Promise<void> {
    const containers = await args.engine.listManaged(args.identity.id);
    const listedIds = new Set<string>();
    const trackerRunners: TrackerSeed[] = [];
    const liveEvents: ProvisionedRunnerReportEventDto[] = [];
    const terminalActions: Array<{
      event: ProvisionedRunnerReportEventDto;
      remove?: string;
      killAndRemove?: string;
    }> = [];

    for (const container of containers) {
      const parsed = parseContainerIdentity(container);
      listedIds.add(parsed.provisionedRunnerId);
      const labels = labelsFor(parsed.templateKey, parsed.labels);
      if (labels.length === 0) {
        logger().warn(
          {provisionedRunnerId: parsed.provisionedRunnerId},
          'Skipping provisioned runner report because labels are unavailable',
        );
        continue;
      }

      if (
        container.state === 'created' &&
        isPastDeadline(container.createdAt, now(), args.registrationDeadlineMs)
      ) {
        terminalActions.push({
          event: eventFor(container, 'terminated', labels, args.providerKind, now()),
          killAndRemove: container.name,
        });
        continue;
      }

      const mapped = mapContainerState(container);
      if (mapped.state === 'starting' || mapped.state === 'running') {
        knownLiveIds.add(parsed.provisionedRunnerId);
        if (parsed.templateKey)
          knownTemplateKeys.set(parsed.provisionedRunnerId, parsed.templateKey);
        liveEvents.push(
          eventFor(container, mapped.state, labels, args.providerKind, now(), mapped.reason),
        );
        const templateKey = parsed.templateKey;
        if (templateKey) {
          trackerRunners.push({
            provisionedRunnerId: parsed.provisionedRunnerId,
            templateKey,
            state: mapped.state,
          });
        }
      } else {
        terminalActions.push({
          event: eventFor(container, mapped.state, labels, args.providerKind, now(), mapped.reason),
          remove: container.name,
        });
      }
    }

    for (const provisionedRunnerId of [...knownLiveIds]) {
      if (listedIds.has(provisionedRunnerId)) continue;
      knownLiveIds.delete(provisionedRunnerId);
      const templateKey = knownTemplateKeys.get(provisionedRunnerId);
      knownTemplateKeys.delete(provisionedRunnerId);
      const template = templateKey ? templatesByKey.get(templateKey) : undefined;
      if (!template) continue;
      terminalActions.push({
        event: {
          provisioned_runner_id: provisionedRunnerId,
          template_key: template.key,
          labels: [...template.labels],
          state: 'terminated',
          reported_at: now().toISOString(),
          provider_kind: args.providerKind,
        },
      });
    }

    args.tracker.replaceAll(trackerRunners);
    if (liveEvents.length > 0) await report(liveEvents);

    for (const action of terminalActions) {
      if (action.killAndRemove) await args.engine.killAndRemove(action.killAndRemove);
      await report([action.event]);
      if (action.remove) await args.engine.remove(action.remove);
      knownLiveIds.delete(action.event.provisioned_runner_id);
      knownTemplateKeys.delete(action.event.provisioned_runner_id);
      args.tracker.remove(action.event.provisioned_runner_id);
    }
  }

  return {
    async launch(launch) {
      const labels = buildContainerLabels({launch, identity: args.identity});
      await report([
        {
          provisioned_runner_id: launch.provisionedRunnerId,
          reservation_id: launch.reservationId,
          template_key: launch.template.key,
          labels: [...launch.template.labels],
          state: 'starting',
          reported_at: now().toISOString(),
          provider_kind: args.providerKind,
        },
      ]);

      try {
        await args.engine.createAndStart({
          name: launch.provisionedRunnerId,
          image: launch.template.spec.image,
          env: launch.runnerEnv,
          labels,
          nanoCpus: Math.round(launch.template.spec.cpu * 1_000_000_000),
          memoryBytes: parseMemoryToBytes(launch.template.spec.memory),
        });
        knownLiveIds.add(launch.provisionedRunnerId);
        knownTemplateKeys.set(launch.provisionedRunnerId, launch.template.key);
      } catch (error) {
        await report([
          {
            provisioned_runner_id: launch.provisionedRunnerId,
            reservation_id: launch.reservationId,
            template_key: launch.template.key,
            labels: [...launch.template.labels],
            state: 'failed',
            reason: truncateReason(errorReason(error)),
            reported_at: now().toISOString(),
            provider_kind: args.providerKind,
          },
        ]);
        throw error;
      }
    },
    observe,
    reconcile: observe,
    flush: () => Promise.resolve(),
  };

  function labelsFor(
    templateKey: string | undefined,
    labels: readonly string[],
  ): readonly string[] {
    if (labels.length > 0) return labels;
    return templateKey ? (templatesByKey.get(templateKey)?.labels ?? []) : [];
  }
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
