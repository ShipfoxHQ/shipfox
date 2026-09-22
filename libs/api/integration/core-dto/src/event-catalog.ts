import {z} from 'zod';

export type IntegrationEventPayloadKind = 'raw-provider' | 'shipfox-normalized';

/**
 * A group of events that share one payload shape, such as issue events or
 * comment events. Reference pages render one section per family.
 */
export interface IntegrationEventFamilyDoc {
  key: string;
  title: string;
  summary: string;
  payloadKind: IntegrationEventPayloadKind;
  /** JSON Schema of the `event` value. Present when Shipfox checks or reshapes it. */
  payloadSchema?: Record<string, unknown> | undefined;
  payloadDocUrl?: string | undefined;
  /** Top-level payload fields Shipfox adds to the provider envelope. */
  shipfoxFields?: readonly string[] | undefined;
  /** Family-level caveats, written as Markdown sentences. */
  notes?: readonly string[] | undefined;
}

export interface IntegrationEventDoc {
  name: string;
  family: string;
  summary: string;
  payloadDocUrl?: string | undefined;
}

export interface IntegrationEventCatalog {
  provider: string;
  passthrough?: boolean | undefined;
  upstreamEventsDocUrl?: string | undefined;
  families: readonly IntegrationEventFamilyDoc[];
  events: readonly IntegrationEventDoc[];
}

/** Serializes a payload schema for the catalog; the `$schema` marker only adds noise. */
export function eventPayloadJsonSchema(schema: z.ZodType): Record<string, unknown> {
  const {$schema: _, ...jsonSchema} = z.toJSONSchema(schema, {unrepresentable: 'any'});
  return jsonSchema;
}

/** Returns the structural problems of a catalog, so provider tests can assert an empty list. */
export function integrationEventCatalogIssues(catalog: IntegrationEventCatalog): string[] {
  const issues: string[] = [];
  const families = new Map(catalog.families.map((family) => [family.key, family]));
  if (families.size !== catalog.families.length) issues.push('Family keys must be unique.');
  for (const family of catalog.families) {
    if (catalog.events.every((event) => event.family !== family.key)) {
      issues.push(`Family "${family.key}" has no events.`);
    }
    if ((family.payloadKind === 'shipfox-normalized') !== (family.payloadSchema !== undefined)) {
      issues.push(`Family "${family.key}" must carry a payload schema exactly when normalized.`);
    }
  }
  for (const event of catalog.events) {
    if (!families.has(event.family)) {
      issues.push(`Event "${event.name}" references the undeclared family "${event.family}".`);
    }
  }
  return issues;
}
