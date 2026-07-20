import type {ModuleRuntimeContext} from '@shipfox/node-module';
import {pruneOutboxRetention} from './prune-outbox-retention.js';

export function createActivities(context: ModuleRuntimeContext) {
  return {
    pruneOutboxRetention: () => pruneOutboxRetention(context.outboxRegistry),
  };
}
