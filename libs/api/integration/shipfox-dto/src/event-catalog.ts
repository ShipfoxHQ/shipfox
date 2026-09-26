import {
  eventPayloadJsonSchema,
  type IntegrationEventCatalog,
} from '@shipfox/api-integration-core-dto';
import {type ShipfoxEventName, shipfoxEventNames} from './constants.js';
import {shipfoxEventPayloadSchemas} from './event-payload.js';

const eventDocs = {
  'run.requested': {title: 'Run requested', summary: 'A workflow run attempt was requested.'},
  'run.started': {title: 'Run started', summary: 'A workflow run attempt started running.'},
  'run.completed': {title: 'Run completed', summary: 'A workflow run attempt completed.'},
  'job.queued': {title: 'Job queued', summary: 'A job execution was queued for a runner.'},
  'job.started': {title: 'Job started', summary: 'A runner claimed a job execution.'},
  'job.completed': {title: 'Job completed', summary: 'A job completed or was skipped.'},
} as const satisfies Record<ShipfoxEventName, {title: string; summary: string}>;

// Each event has its own payload shape, so each event is its own family.
export const shipfoxEventCatalog = {
  provider: 'Shipfox',
  families: shipfoxEventNames.map((name) => ({
    key: name,
    title: eventDocs[name].title,
    summary: eventDocs[name].summary,
    payloadKind: 'shipfox-normalized' as const,
    payloadSchema: eventPayloadJsonSchema(shipfoxEventPayloadSchemas[name]),
  })),
  events: shipfoxEventNames.map((name) => ({
    name,
    family: name,
    summary: eventDocs[name].summary,
  })),
} as const satisfies IntegrationEventCatalog;
