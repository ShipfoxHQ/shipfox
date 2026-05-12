import {pruneWebhookDeliveriesActivity} from './prune-webhook-deliveries.js';

export function createIntegrationsMaintenanceActivities() {
  return {
    pruneWebhookDeliveriesActivity,
  };
}
