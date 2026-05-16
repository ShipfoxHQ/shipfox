import type {DefinitionDeletedEvent} from '@shipfox/api-definitions-dto';
import type {DomainEvent} from '@shipfox/node-outbox';
import {deleteSubscriptionsForDefinition} from '#db/subscriptions.js';

export async function onDefinitionDeleted(event: DomainEvent): Promise<void> {
  const payload = event.payload as DefinitionDeletedEvent;
  await deleteSubscriptionsForDefinition({workflowDefinitionId: payload.definitionId});
}
