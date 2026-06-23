import {drainAndDispatch} from './drain-and-dispatch.js';
import {pruneOutboxRetention} from './prune-outbox-retention.js';

export function createActivities() {
  return {
    drainAndDispatch,
    pruneOutboxRetention,
  };
}
