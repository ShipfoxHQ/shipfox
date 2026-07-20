import type {TemplateCounts} from '#types.js';

export type ProviderRunnerLifecycle = 'starting' | 'running';

/**
 * The provisioner's in-memory view of the runners it is managing, grouped per
 * template so the control loop can advertise live capacity and stop requesting
 * reservations once a template hits its concurrency cap. This is the loop's own
 * book-keeping, seeded as it starts runners; the backend stays the source of truth
 * for demand and reconciliation.
 */
export interface ProviderRunnerTracker {
  recordStarting(args: {providerRunnerId: string; templateKey: string}): void;
  markRunning(providerRunnerId: string): void;
  remove(providerRunnerId: string): void;
  replaceAll(
    runners: readonly {
      providerRunnerId: string;
      templateKey: string;
      state: ProviderRunnerLifecycle;
    }[],
  ): void;
  countsByTemplate(): Map<string, TemplateCounts>;
}

interface TrackedRunner {
  templateKey: string;
  state: ProviderRunnerLifecycle;
}

export function createInMemoryTracker(): ProviderRunnerTracker {
  const runners = new Map<string, TrackedRunner>();

  return {
    recordStarting({providerRunnerId, templateKey}) {
      runners.set(providerRunnerId, {templateKey, state: 'starting'});
    },
    markRunning(providerRunnerId) {
      const runner = runners.get(providerRunnerId);
      if (runner) runner.state = 'running';
    },
    remove(providerRunnerId) {
      runners.delete(providerRunnerId);
    },
    replaceAll(nextRunners) {
      runners.clear();
      for (const runner of nextRunners) {
        runners.set(runner.providerRunnerId, {
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
