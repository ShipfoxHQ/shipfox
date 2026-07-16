export type IntegrationEventPayloadKind = 'raw-provider' | 'shipfox-normalized';

export interface IntegrationEventDoc {
  name: string;
  summary: string;
  emittedWhen: string;
  payloadKind: IntegrationEventPayloadKind;
  payloadDocUrl?: string | undefined;
}

export interface IntegrationEventCatalog {
  provider: string;
  passthrough?: boolean | undefined;
  upstreamEventsDocUrl?: string | undefined;
  events: readonly IntegrationEventDoc[];
}
