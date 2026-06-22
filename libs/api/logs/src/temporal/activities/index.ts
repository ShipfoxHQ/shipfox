import {closeAbandonedStreamsActivity} from './close-abandoned-streams.js';
import {compactStreamActivity} from './compact-stream.js';
import {compactionReconcileActivity} from './compaction-reconcile.js';
import {reapStaleOpenStreamsActivity} from './reap-stale-open-streams.js';
import {retentionSweepActivity} from './retention-sweep.js';

export function createLogsActivities() {
  return {
    closeAbandonedStreamsActivity,
    compactStreamActivity,
    compactionReconcileActivity,
    reapStaleOpenStreamsActivity,
    retentionSweepActivity,
  };
}
