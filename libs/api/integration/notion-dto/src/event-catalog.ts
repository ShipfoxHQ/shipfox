import type {IntegrationEventCatalog} from '@shipfox/api-integration-core-dto';
import {notionWebhookEventNames} from './schemas/index.js';

const notionEventsDocsUrl = 'https://developers.notion.com/reference/webhooks-events-delivery';

const eventDetails = {
  'page.created': {
    summary: 'A Notion page is created.',
    emittedWhen: 'Notion sends a page.created webhook.',
  },
  'page.content_updated': {
    summary: 'The content of a Notion page changes.',
    emittedWhen: 'Notion sends a page.content_updated webhook.',
  },
  'page.properties_updated': {
    summary: 'The properties of a Notion page change.',
    emittedWhen: 'Notion sends a page.properties_updated webhook.',
  },
  'page.moved': {
    summary: 'A Notion page is moved.',
    emittedWhen: 'Notion sends a page.moved webhook.',
  },
  'page.deleted': {
    summary: 'A Notion page is deleted.',
    emittedWhen: 'Notion sends a page.deleted webhook.',
  },
  'page.undeleted': {
    summary: 'A Notion page is undeleted.',
    emittedWhen: 'Notion sends a page.undeleted webhook.',
  },
  'page.locked': {
    summary: 'A Notion page is locked.',
    emittedWhen: 'Notion sends a page.locked webhook.',
  },
  'page.unlocked': {
    summary: 'A Notion page is unlocked.',
    emittedWhen: 'Notion sends a page.unlocked webhook.',
  },
  'data_source.created': {
    summary: 'A Notion data source is created.',
    emittedWhen: 'Notion sends a data_source.created webhook.',
  },
  'data_source.content_updated': {
    summary: 'The content of a Notion data source changes.',
    emittedWhen: 'Notion sends a data_source.content_updated webhook.',
  },
  'data_source.moved': {
    summary: 'A Notion data source is moved.',
    emittedWhen: 'Notion sends a data_source.moved webhook.',
  },
  'data_source.deleted': {
    summary: 'A Notion data source is deleted.',
    emittedWhen: 'Notion sends a data_source.deleted webhook.',
  },
  'data_source.undeleted': {
    summary: 'A Notion data source is undeleted.',
    emittedWhen: 'Notion sends a data_source.undeleted webhook.',
  },
  'data_source.schema_updated': {
    summary: 'The schema of a Notion data source changes.',
    emittedWhen: 'Notion sends a data_source.schema_updated webhook.',
  },
  'database.created': {
    summary: 'A Notion database is created.',
    emittedWhen: 'Notion sends a database.created webhook.',
  },
  'database.moved': {
    summary: 'A Notion database is moved.',
    emittedWhen: 'Notion sends a database.moved webhook.',
  },
  'database.deleted': {
    summary: 'A Notion database is deleted.',
    emittedWhen: 'Notion sends a database.deleted webhook.',
  },
  'database.undeleted': {
    summary: 'A Notion database is undeleted.',
    emittedWhen: 'Notion sends a database.undeleted webhook.',
  },
  'comment.created': {
    summary: 'A comment is added to a Notion page.',
    emittedWhen: 'Notion sends a comment.created webhook.',
  },
  'comment.updated': {
    summary: 'A Notion comment changes.',
    emittedWhen: 'Notion sends a comment.updated webhook.',
  },
  'comment.deleted': {
    summary: 'A Notion comment is deleted.',
    emittedWhen: 'Notion sends a comment.deleted webhook.',
  },
} as const satisfies Record<
  (typeof notionWebhookEventNames)[number],
  {
    summary: string;
    emittedWhen: string;
  }
>;

export const notionEventCatalog = {
  provider: 'Notion',
  upstreamEventsDocUrl: notionEventsDocsUrl,
  events: notionWebhookEventNames.map((name) => ({
    name,
    ...eventDetails[name],
    payloadKind: 'raw-provider' as const,
    payloadDocUrl: notionEventsDocsUrl,
  })),
} as const satisfies IntegrationEventCatalog;
