import type {TemplateCounts} from '#types.js';

export type ProvisionedRunnerLifecycle = 'starting' | 'running';

/**
 * The provisioner's in-memory view of the runners it is managing, grouped per
 * template so the control loop can advertise live capacity and stop requesting
 * reservations once a template hits its concurrency cap. This is the loop's own
 * book-keeping, seeded as it starts runners; the backend stays the source of truth
 * for demand and reconciliation.
 */
export interface ProvisionedRunnerTracker {
  recordStarting(args: {provisionedRunnerId: string; templateKey: string}): void;
  markRunning(provisionedRunnerId: string): void;
  remove(provisionedRunnerId: string): void;
  replaceAll(
    runners: readonly {
      provisionedRunnerId: string;
      templateKey: string;
      state: ProvisionedRunnerLifecycle;
    }[],
  ): void;
  countsByTemplate(): Map<string, TemplateCounts>;
}

interface TrackedRunner {
  templateKey: string;
  state: ProvisionedRunnerLifecycle;
}

export function createInMemoryTracker(): ProvisionedRunnerTracker {
  const runners = new Map<string, TrackedRunner>();

  return {
    recordStarting({provisionedRunnerId, templateKey}) {
      runners.set(provisionedRunnerId, {templateKey, state: 'starting'});
    },
    markRunning(provisionedRunnerId) {
      const runner = runners.get(provisionedRunnerId);
      if (runner) runner.state = 'running';
    },
    remove(provisionedRunnerId) {
      runners.delete(provisionedRunnerId);
    },
    replaceAll(nextRunners) {
      runners.clear();
      for (const runner of nextRunners) {
        runners.set(runner.provisionedRunnerId, {
          templateKey: runner.templateKey,
          state: runner.state,
        });
      }
    },
    countsByTemplate() {
      const counts = new Map<string, {starting: number; running: number}>();
      for (const {templateKey, state} of runners.values()) {
        const current = counts.get(templateKey) ?? {starting: 0, running: 0};
        current[state] += 1;
        counts.set(templateKey, current);
      }
      return counts;
    },
  };
}
