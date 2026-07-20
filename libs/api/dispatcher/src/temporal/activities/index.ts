import {pruneOutboxRetention} from './prune-outbox-retention.js';

export function createActivities() {
  return {
    pruneOutboxRetention,
  };
}
