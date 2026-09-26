import type {IntegrationEventCatalog} from '@shipfox/api-integration-core-dto';

/** The catalog remains empty until a producer delivers a Shipfox event. */
export const shipfoxEventCatalog = {
  provider: 'Shipfox',
  families: [],
  events: [],
} as const satisfies IntegrationEventCatalog;
