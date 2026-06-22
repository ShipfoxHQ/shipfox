import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

export {closeDb, db, schema} from './db.js';
export {
  getTriggerEventById,
  type ListTriggerEventsParams,
  type ListTriggerEventsResult,
  listDecisionsByReceivedEventId,
  listTriggerEvents,
  type TriggerEventCursor,
  type TriggerEventListFilters,
} from './event-queries.js';
export {triggersOutbox} from './schema/outbox.js';
export {triggerSubscriptions} from './schema/subscriptions.js';
export {
  deleteSubscriptionsForDefinition,
  findMatchingSubscriptions,
  getManualSubscriptionByDefinitionId,
  getTriggerSubscriptionById,
  listSubscriptionsByWorkflowDefinitionIds,
  projectDefinitionTriggers,
} from './subscriptions.js';

export const migrationsPath = resolve(dirname(fileURLToPath(import.meta.url)), '../../drizzle');
