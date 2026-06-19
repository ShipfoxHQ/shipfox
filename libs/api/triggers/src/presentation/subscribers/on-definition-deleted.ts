import type {DefinitionDeletedEvent} from '@shipfox/api-definitions-dto';
import {deleteSubscriptionsForDefinition} from '#db/subscriptions.js';

export async function onDefinitionDeleted(payload: DefinitionDeletedEvent): Promise<void> {
  await deleteSubscriptionsForDefinition({workflowDefinitionId: payload.definitionId});
}
