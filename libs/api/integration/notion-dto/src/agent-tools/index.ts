import {z} from 'zod';

export const notionAgentToolIds = [
  'search',
  'get_page',
  'get_page_content',
  'query_data_source',
  'get_comments',
  'create_page',
  'update_page',
  'add_comment',
] as const;

export const notionAgentToolIdSchema = z.enum(notionAgentToolIds);
export type NotionAgentToolId = z.infer<typeof notionAgentToolIdSchema>;
