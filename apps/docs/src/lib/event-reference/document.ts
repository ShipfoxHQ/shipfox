import type {ToolReferenceExample, ToolReferenceField} from '@/lib/tool-reference/document';

export type EventPayloadKind = 'raw-provider' | 'shipfox-normalized';

export interface EventReferenceEvent {
  name: string;
  anchor: string;
  summary: string;
  payloadDocUrl?: string;
  /** A trigger fragment and, for normalized families, a sample payload. */
  examples: ToolReferenceExample[];
}

export interface EventReferenceFamily {
  key: string;
  title: string;
  anchor: string;
  summary: string;
  payloadKind: EventPayloadKind;
  payloadDocUrl?: string;
  notes: string[];
  /** Payload fields Shipfox validates; empty for raw provider payloads. */
  fields: ToolReferenceField[];
  /** Top-level field names Shipfox adds to the provider envelope. */
  shipfoxFields: string[];
  /** Whether the provider may add fields beyond the validated ones. */
  openPayload: boolean;
  events: EventReferenceEvent[];
}

export interface EventReferenceDocument {
  /** Generated file id such as `integrations/jira/events`. */
  id: string;
  provider: string;
  /** Sample integration connection slug used in trigger fragments. */
  connection: string;
  upstreamEventsDocUrl?: string;
  /** Whether Shipfox forwards provider events beyond the documented catalog. */
  passthrough: boolean;
  eventCount: number;
  families: EventReferenceFamily[];
  /** Machine-readable serialization used by the LLM text and link checks. */
  markdown: string;
}
