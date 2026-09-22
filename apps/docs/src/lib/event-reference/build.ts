import GithubSlugger from 'github-slugger';
import type {
  EventPayloadKind,
  EventReferenceDocument,
  EventReferenceEvent,
  EventReferenceFamily,
} from '@/lib/event-reference/document';
import {type EventTriggerOptions, eventExamples} from '@/lib/event-reference/examples';
import {serializeEventReferenceMarkdown} from '@/lib/event-reference/markdown';
import {type JsonSchema, schemaFields} from '@/lib/tool-reference/schema-fields';

export interface EventFamilyLike {
  key: string;
  title: string;
  summary: string;
  payloadKind: EventPayloadKind;
  payloadSchema?: JsonSchema | undefined;
  payloadDocUrl?: string | undefined;
  shipfoxFields?: readonly string[] | undefined;
  notes?: readonly string[] | undefined;
}

export interface EventLike {
  name: string;
  family: string;
  summary: string;
  payloadDocUrl?: string | undefined;
}

export interface EventCatalogLike {
  provider: string;
  passthrough?: boolean | undefined;
  upstreamEventsDocUrl?: string | undefined;
  families: readonly EventFamilyLike[];
  events: readonly EventLike[];
}

export interface EventReferenceInput {
  id: string;
  catalog: EventCatalogLike;
  /** Slug of the integration connection used in trigger fragments. */
  connection: string;
  trigger?: EventTriggerOptions | undefined;
}

export function buildEventReference(input: EventReferenceInput): EventReferenceDocument {
  const declared = new Set(input.catalog.families.map((family) => family.key));
  for (const event of input.catalog.events) {
    if (!declared.has(event.family)) {
      throw new Error(`Event ${event.name} references the undeclared family ${event.family}.`);
    }
  }
  // Anchors follow the markdown heading order so link checks resolve the same ids.
  const slugger = new GithubSlugger();
  const families = input.catalog.families.map((family) => eventFamily(family, input, slugger));
  const document = {
    id: input.id,
    provider: input.catalog.provider,
    connection: input.connection,
    ...(input.catalog.upstreamEventsDocUrl
      ? {upstreamEventsDocUrl: input.catalog.upstreamEventsDocUrl}
      : {}),
    passthrough: input.catalog.passthrough === true,
    eventCount: input.catalog.events.length,
    families,
  };
  return {...document, markdown: serializeEventReferenceMarkdown(document)};
}

function eventFamily(
  family: EventFamilyLike,
  input: EventReferenceInput,
  slugger: GithubSlugger,
): EventReferenceFamily {
  const schema = family.payloadSchema ? normalizePayloadSchema(family.payloadSchema) : undefined;
  const fields = schema ? schemaFields(schema) : [];
  const events = input.catalog.events.filter((event) => event.family === family.key);
  if (events.length === 0) throw new Error(`Family ${family.key} has no events.`);
  const anchor = slugger.slug(family.title);
  return {
    key: family.key,
    title: family.title,
    anchor,
    summary: family.summary,
    payloadKind: family.payloadKind,
    ...(family.payloadDocUrl ? {payloadDocUrl: family.payloadDocUrl} : {}),
    notes: [...(family.notes ?? [])],
    fields,
    shipfoxFields: [...(family.shipfoxFields ?? [])],
    openPayload: schema !== undefined && isOpenObject(schema),
    events: events.map((event) => eventEntry(event, fields, input, slugger)),
  };
}

function eventEntry(
  event: EventLike,
  fields: EventReferenceFamily['fields'],
  input: EventReferenceInput,
  slugger: GithubSlugger,
): EventReferenceEvent {
  return {
    name: event.name,
    anchor: slugger.slug(event.name),
    summary: event.summary,
    ...(event.payloadDocUrl ? {payloadDocUrl: event.payloadDocUrl} : {}),
    examples: eventExamples({
      eventName: event.name,
      connection: input.connection,
      fields,
      trigger: input.trigger,
    }),
  };
}

function isOpenObject(schema: JsonSchema): boolean {
  return schema.additionalProperties !== undefined && schema.additionalProperties !== false;
}

// Zod serializes its safe-integer bounds and non-empty string guards as
// constraints; they carry no information for a reader.
function normalizePayloadSchema(schema: JsonSchema): JsonSchema {
  return normalizeNode(structuredClone(schema)) as JsonSchema;
}

function normalizeNode(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(normalizeNode);
  if (typeof node !== 'object' || node === null) return node;
  const record = node as Record<string, unknown>;
  if (record.minimum === -Number.MAX_SAFE_INTEGER) delete record.minimum;
  if (record.maximum === Number.MAX_SAFE_INTEGER) delete record.maximum;
  if (record.minLength === 1) delete record.minLength;
  delete record.$schema;
  delete record.propertyNames;
  for (const [key, value] of Object.entries(record)) record[key] = normalizeNode(value);
  return record;
}
