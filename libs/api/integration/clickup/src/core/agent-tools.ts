import type {
  ClickUpAgentToolId,
  ClickUpAgentToolRequiredScope,
  ClickUpAgentToolCatalogEntry as ClickUpDtoAgentToolCatalogEntry,
} from '@shipfox/api-integration-clickup-dto';
import type {
  AgentToolCatalogEntry,
  AgentToolJsonSchema,
  AgentToolSelectionCatalog,
  AgentToolSelector,
} from '@shipfox/api-integration-spi';
import type {ClickUpAgentToolHttpMethod, ClickUpAgentToolQueryValue} from '#api/client.js';

export type ClickUpAgentToolCatalogEntry = ClickUpDtoAgentToolCatalogEntry;
export type {ClickUpAgentToolId, ClickUpAgentToolRequiredScope};

interface ClickUpAgentToolCatalogInput {
  id: ClickUpAgentToolId;
  description: string;
  sensitivity: 'read' | 'write';
  sensitive: boolean;
  requiredScope: ClickUpAgentToolRequiredScope;
  inputSchema: AgentToolJsonSchema;
}

const taskIdSchema = stringSchema('ClickUp task ID or custom task ID');
const customTaskIdSchema = booleanSchema('Address the task with its custom task ID');
const listIdsSchema = arraySchema(stringSchema('ClickUp List ID'));
const spaceIdsSchema = arraySchema(stringSchema('ClickUp Space ID'));
const folderIdsSchema = arraySchema(stringSchema('ClickUp Folder ID'));
const statusesSchema = arraySchema(stringSchema('ClickUp task status'));
const assigneesSchema = arraySchema(integerSchema('ClickUp assignee ID'));
const tagsSchema = arraySchema(stringSchema('ClickUp task tag'));
const prioritySchema = integerSchema('Priority from 1 (urgent) to 4 (low)');
const dateSchema = integerSchema('Unix timestamp in milliseconds');
const customFieldsSchema = arraySchema(recordSchema('ClickUp custom field value'));

export const clickupAgentToolCatalog = [
  tool({
    id: 'get_task',
    description:
      'Retrieve a ClickUp task by ID. Set custom_task_id to true for a custom task ID. Dates use Unix milliseconds.',
    sensitivity: 'read',
    sensitive: false,
    requiredScope: 'read',
    inputSchema: objectSchema(
      {
        task_id: taskIdSchema,
        custom_task_id: customTaskIdSchema,
        include_subtasks: booleanSchema('Include subtasks in the response'),
      },
      ['task_id'],
    ),
  }),
  tool({
    id: 'search_tasks',
    description:
      'Filter ClickUp tasks by List, status, assignee, tag, or date. This is a filtered list, not full-text search.',
    sensitivity: 'read',
    sensitive: false,
    requiredScope: 'read',
    inputSchema: objectSchema({
      list_ids: listIdsSchema,
      space_ids: spaceIdsSchema,
      folder_ids: folderIdsSchema,
      statuses: statusesSchema,
      assignees: assigneesSchema,
      tags: tagsSchema,
      include_closed: booleanSchema('Include closed tasks'),
      subtasks: booleanSchema('Include subtasks'),
      date_updated_gt: dateSchema,
      due_date_lt: dateSchema,
      order_by: stringSchema('Task field used for ordering'),
      page: integerSchema('Zero-based result page'),
    }),
  }),
  tool({
    id: 'get_task_comments',
    description:
      'List comments on a ClickUp task. Set custom_task_id to true for a custom task ID.',
    sensitivity: 'read',
    sensitive: false,
    requiredScope: 'read',
    inputSchema: objectSchema(
      {
        task_id: taskIdSchema,
        custom_task_id: customTaskIdSchema,
        start: integerSchema('Comment pagination start timestamp'),
        start_id: stringSchema('Comment ID for pagination'),
      },
      ['task_id'],
    ),
  }),
  tool({
    id: 'create_task',
    description:
      'Create a ClickUp task in a List. Priorities are 1 (urgent) to 4 (low), dates use Unix milliseconds, and notifications are disabled.',
    sensitivity: 'write',
    sensitive: false,
    requiredScope: 'write',
    inputSchema: objectSchema(
      {
        list_id: stringSchema('ClickUp List ID'),
        name: stringSchema('Task name'),
        markdown_content: stringSchema('Markdown task description'),
        assignees: assigneesSchema,
        tags: tagsSchema,
        status: stringSchema('Task status'),
        priority: prioritySchema,
        due_date: dateSchema,
        parent: stringSchema('Parent task ID'),
        custom_fields: customFieldsSchema,
        notify_all: {
          type: 'boolean',
          const: false,
          description: 'Notifications are disabled',
        },
      },
      ['list_id', 'name'],
    ),
  }),
  tool({
    id: 'update_task',
    description:
      'Update a ClickUp task. Set custom_task_id to true for a custom task ID. Priorities are 1 (urgent) to 4 (low), and dates use Unix milliseconds.',
    sensitivity: 'write',
    sensitive: false,
    requiredScope: 'write',
    inputSchema: objectSchema(
      {
        task_id: taskIdSchema,
        custom_task_id: customTaskIdSchema,
        name: stringSchema('Replacement task name'),
        markdown_content: stringSchema('Replacement Markdown task description'),
        status: stringSchema('Replacement task status'),
        priority: prioritySchema,
        due_date: dateSchema,
        assignees: recordSchema('Assignees to add or remove, with add and rem arrays'),
      },
      ['task_id'],
    ),
  }),
  tool({
    id: 'add_comment',
    description:
      'Add a plain-text comment to a ClickUp task. Markdown is not rendered and notifications are disabled.',
    sensitivity: 'write',
    sensitive: false,
    requiredScope: 'write',
    inputSchema: objectSchema(
      {
        task_id: taskIdSchema,
        custom_task_id: customTaskIdSchema,
        body: stringSchema('Plain-text comment body'),
      },
      ['task_id', 'body'],
    ),
  }),
] as const satisfies readonly ClickUpAgentToolCatalogEntry[];

export const clickupAgentToolSelectionCatalog =
  buildClickUpAgentToolSelectionCatalog(clickupAgentToolCatalog);

export interface ClickUpToolOperation {
  method: ClickUpAgentToolHttpMethod;
  path: (args: Record<string, unknown>, teamId: string) => string;
  query?: (
    args: Record<string, unknown>,
    teamId: string,
  ) => Record<string, ClickUpAgentToolQueryValue>;
  body?: (args: Record<string, unknown>) => unknown;
}

export const CLICKUP_TOOL_OPERATIONS: Record<ClickUpAgentToolId, ClickUpToolOperation> = {
  get_task: {
    method: 'GET',
    path: (args) => taskPath(args),
    query: (args, teamId) => ({
      include_markdown_description: true,
      ...(args.include_subtasks === undefined
        ? {}
        : {include_subtasks: args.include_subtasks as boolean}),
      ...customTaskIdQuery(args, teamId),
    }),
  },
  search_tasks: {
    method: 'GET',
    path: (_args, teamId) => `/team/${encodeURIComponent(teamId)}/task`,
    query: (args) =>
      definedArguments(args, [
        ['list_ids', 'list_ids[]'],
        ['space_ids', 'space_ids[]'],
        ['folder_ids', 'folder_ids[]'],
        ['statuses', 'statuses[]'],
        ['assignees', 'assignees[]'],
        ['tags', 'tags[]'],
        ['include_closed', 'include_closed'],
        ['subtasks', 'subtasks'],
        ['date_updated_gt', 'date_updated_gt'],
        ['due_date_lt', 'due_date_lt'],
        ['order_by', 'order_by'],
        ['page', 'page'],
      ]),
  },
  get_task_comments: {
    method: 'GET',
    path: (args) => taskPath(args, 'comment'),
    query: (args, teamId) => ({
      ...customTaskIdQuery(args, teamId),
      ...definedArguments(args, [
        ['start', 'start'],
        ['start_id', 'start_id'],
      ]),
    }),
  },
  create_task: {
    method: 'POST',
    path: (args) => `/list/${encodeURIComponent(stringArgument(args, 'list_id'))}/task`,
    body: (args) => ({
      ...definedArguments(args, [
        ['name', 'name'],
        ['markdown_content', 'markdown_content'],
        ['assignees', 'assignees'],
        ['tags', 'tags'],
        ['status', 'status'],
        ['priority', 'priority'],
        ['due_date', 'due_date'],
        ['parent', 'parent'],
        ['custom_fields', 'custom_fields'],
      ]),
      notify_all: false,
    }),
  },
  update_task: {
    method: 'PUT',
    path: (args) => taskPath(args),
    query: (args, teamId) => customTaskIdQuery(args, teamId),
    body: (args) =>
      definedArguments(args, [
        ['name', 'name'],
        ['markdown_content', 'markdown_content'],
        ['status', 'status'],
        ['priority', 'priority'],
        ['due_date', 'due_date'],
        ['assignees', 'assignees'],
      ]),
  },
  add_comment: {
    method: 'POST',
    path: (args) => taskPath(args, 'comment'),
    query: (args, teamId) => customTaskIdQuery(args, teamId),
    body: (args) => ({comment_text: stringArgument(args, 'body'), notify_all: false}),
  },
};

export function customTaskIdQuery(
  args: Record<string, unknown>,
  teamId: string,
): Record<string, ClickUpAgentToolQueryValue> {
  return args.custom_task_id === true ? {custom_task_ids: true, team_id: teamId} : {};
}

function taskPath(args: Record<string, unknown>, suffix = ''): string {
  const taskId = encodeURIComponent(stringArgument(args, 'task_id'));
  return `/task/${taskId}${suffix.length > 0 ? `/${suffix}` : ''}`;
}

function definedArguments(
  args: Record<string, unknown>,
  names: readonly (readonly [string, string])[],
): Record<string, ClickUpAgentToolQueryValue> {
  return Object.fromEntries(
    names
      .map(([inputName, outputName]) => [outputName, args[inputName]] as const)
      .filter(([, value]) => value !== undefined),
  ) as Record<string, ClickUpAgentToolQueryValue>;
}

function stringArgument(args: Record<string, unknown>, name: string): string {
  const value = args[name];
  return typeof value === 'string' ? value : String(value ?? '');
}

function buildClickUpAgentToolSelectionCatalog(
  catalog: readonly AgentToolCatalogEntry<ClickUpAgentToolRequiredScope>[],
): AgentToolSelectionCatalog {
  return {
    selectors: catalog.map(
      (entry): AgentToolSelector => ({
        token: entry.id,
        kind: 'standalone',
        sensitivity: entry.sensitivity,
        sensitive: entry.sensitive,
      }),
    ),
  };
}

function tool(input: ClickUpAgentToolCatalogInput): ClickUpAgentToolCatalogEntry {
  return input;
}

function objectSchema(
  properties: Record<string, AgentToolJsonSchema>,
  required: string[] = [],
): AgentToolJsonSchema {
  return {
    type: 'object',
    additionalProperties: false,
    properties,
    ...(required.length > 0 ? {required} : {}),
  };
}

function stringSchema(description?: string): AgentToolJsonSchema {
  return {type: 'string', ...(description === undefined ? {} : {description})};
}

function booleanSchema(description?: string): AgentToolJsonSchema {
  return {type: 'boolean', ...(description === undefined ? {} : {description})};
}

function integerSchema(description?: string): AgentToolJsonSchema {
  return {type: 'integer', ...(description === undefined ? {} : {description})};
}

function arraySchema(items: AgentToolJsonSchema): AgentToolJsonSchema {
  return {type: 'array', items};
}

function recordSchema(description?: string): AgentToolJsonSchema {
  return {
    type: 'object',
    additionalProperties: true,
    ...(description === undefined ? {} : {description}),
  };
}
