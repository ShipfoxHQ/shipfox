import type {IntegrationEventCatalog} from '@shipfox/api-integration-core-dto';
import {notionWebhookEventNames} from './schemas/index.js';

const notionEventsDocsUrl = 'https://developers.notion.com/reference/webhooks-events-delivery';

const eventSummaries = {
  'page.created': 'A Notion page is created.',
  'page.content_updated': 'The content of a Notion page changes.',
  'page.properties_updated': 'The properties of a Notion page change.',
  'page.moved': 'A Notion page is moved.',
  'page.deleted': 'A Notion page is deleted.',
  'page.undeleted': 'A Notion page is undeleted.',
  'page.locked': 'A Notion page is locked.',
  'page.unlocked': 'A Notion page is unlocked.',
  'data_source.created': 'A Notion data source is created.',
  'data_source.content_updated': 'The content of a Notion data source changes.',
  'data_source.moved': 'A Notion data source is moved.',
  'data_source.deleted': 'A Notion data source is deleted.',
  'data_source.undeleted': 'A Notion data source is undeleted.',
  'data_source.schema_updated': 'The schema of a Notion data source changes.',
  'database.created': 'A Notion database is created.',
  'database.moved': 'A Notion database is moved.',
  'database.deleted': 'A Notion database is deleted.',
  'database.undeleted': 'A Notion database is undeleted.',
  'comment.created': 'A comment is added to a Notion page.',
  'comment.updated': 'A Notion comment changes.',
  'comment.deleted': 'A Notion comment is deleted.',
} as const satisfies Record<(typeof notionWebhookEventNames)[number], string>;

const families = [
  ['page', 'Pages', 'Changes to a Notion page and its content.'],
  ['data_source', 'Data sources', 'Changes to a Notion data source, its content, and its schema.'],
  ['database', 'Databases', 'Changes to a Notion database.'],
  ['comment', 'Comments', 'Comments on a Notion page or block.'],
] as const satisfies readonly (readonly [key: string, title: string, summary: string])[];

export const notionEventCatalog = {
  provider: 'Notion',
  upstreamEventsDocUrl: notionEventsDocsUrl,
  families: families.map(([key, title, summary]) => ({
    key,
    title,
    summary,
    payloadKind: 'raw-provider' as const,
    payloadDocUrl: notionEventsDocsUrl,
  })),
  events: notionWebhookEventNames.map((name) => ({
    name,
    family: name.slice(0, name.indexOf('.')),
    summary: eventSummaries[name],
  })),
} as const satisfies IntegrationEventCatalog;
