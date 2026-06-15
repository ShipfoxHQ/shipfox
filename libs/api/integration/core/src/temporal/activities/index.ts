import {pruneUnclaimedSentryInstallationsActivity} from './prune-unclaimed-sentry-installations.js';
import {pruneWebhookDeliveriesActivity} from './prune-webhook-deliveries.js';

export function createIntegrationsMaintenanceActivities() {
  return {
    pruneWebhookDeliveriesActivity,
    pruneUnclaimedSentryInstallationsActivity,
  };
}
