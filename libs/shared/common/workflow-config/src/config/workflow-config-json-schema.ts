import {z} from 'zod';
import {workflowConfigSchema} from './workflow-config.js';

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | readonly JsonValue[]
  | {readonly [key: string]: JsonValue};

export type JsonObject = {readonly [key: string]: JsonValue};

export const workflowConfigJsonSchema: JsonObject = {
  ...(z.toJSONSchema(workflowConfigSchema, {io: 'input', target: 'draft-2020-12'}) as JsonObject),
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'Shipfox Workflow Config',
  description: 'External Shipfox workflow configuration accepted by YAML authoring surfaces.',
} satisfies JsonObject;
