import {DEFINITION_DELETED, DEFINITION_RESOLVED} from '@shipfox/api-definitions-dto';
import {INTEGRATION_EVENT_RECEIVED} from '@shipfox/api-integration-core-dto';
import type {ShipfoxModule} from '@shipfox/node-module';
import {db, migrationsPath, triggersOutbox} from '#db/index.js';
import {routes} from '#presentation/index.js';
import {
  onDefinitionDeleted,
  onDefinitionResolved,
  onIntegrationEventReceived,
} from '#presentation/subscribers/index.js';

export type {TriggerSubscription} from '#core/entities/subscription.js';
export {
  fireManualSubscription,
  TriggerSubscriptionNotFoundError,
  TriggerSubscriptionNotManualError,
  TriggerWorkspaceMismatchError,
} from '#core/index.js';
export {
  db,
  findMatchingSubscriptions,
  getTriggerSubscriptionById,
  listSubscriptionsByWorkflowDefinitionIds,
  migrationsPath,
  triggersOutbox,
} from '#db/index.js';

export const triggersModule: ShipfoxModule = {
  name: 'triggers',
  database: {db, migrationsPath},
  routes,
  publishers: [{name: 'triggers', table: triggersOutbox, db}],
  subscribers: [
    {event: DEFINITION_RESOLVED, handler: onDefinitionResolved},
    {event: DEFINITION_DELETED, handler: onDefinitionDeleted},
    {event: INTEGRATION_EVENT_RECEIVED, handler: onIntegrationEventReceived},
  ],
};
