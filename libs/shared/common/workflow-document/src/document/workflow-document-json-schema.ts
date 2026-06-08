import {z} from 'zod';
import {workflowDocumentSchema} from './workflow-document.js';

export type JsonValue = string | number | boolean | null | JsonValue[] | {[key: string]: JsonValue};

export type JsonObject = {[key: string]: JsonValue};

const schema: JsonObject = {
  ...(z.toJSONSchema(workflowDocumentSchema, {io: 'input', target: 'draft-2020-12'}) as JsonObject),
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://schemas.shipfox.dev/workflow-document.schema.json',
  title: 'Shipfox Workflow Document',
  description: 'External Shipfox workflow document accepted by YAML authoring surfaces.',
};

const schemaProperties = asJsonObject(schema.properties, 'properties');
asJsonObject(schemaProperties.jobs, 'properties.jobs').minProperties = 1;
asJsonObject(schemaProperties.triggers, 'properties.triggers').minProperties = 1;

export const workflowDocumentJsonSchema: JsonObject = schema;

function asJsonObject(value: JsonValue | undefined, path: string): JsonObject {
  if (value === undefined || value === null || Array.isArray(value) || typeof value !== 'object') {
    throw new TypeError(`Expected generated JSON Schema path "${path}" to be an object`);
  }

  return value;
}
