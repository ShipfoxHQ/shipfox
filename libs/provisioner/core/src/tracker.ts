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
  /** Record a runner the loop has just asked the provider to create. */
  recordStarting(args: {provisionedRunnerId: string; templateKey: string}): void;
  /** Promote a runner to running once the provider confirms it exists. */
  markRunning(provisionedRunnerId: string): void;
  /** Drop a runner that has stopped, failed, or been terminated. */
  remove(provisionedRunnerId: string): void;
  /** Current starting/running counts per template key. */
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
