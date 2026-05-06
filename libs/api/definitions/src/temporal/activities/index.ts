import type {IntegrationSourceControlService} from '@shipfox/api-integration-core';
import {createSyncDefinitionsActivity} from './sync-activities.js';

export function createDefinitionSyncActivities(sourceControl: IntegrationSourceControlService) {
  return {
    syncDefinitionsForProjectSource: createSyncDefinitionsActivity(sourceControl),
  };
}
