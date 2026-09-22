import 'server-only';

import type {EventReferenceDocument} from '@/lib/event-reference/document';
import {readGeneratedDocument} from '@/lib/read-generated-document';

/** Reads a generated event reference document by its id, such as `integrations/jira/events`. */
export function getEventReferenceDocument(id: string): EventReferenceDocument {
  return readGeneratedDocument<EventReferenceDocument>('Event reference', id, (document) =>
    Array.isArray(document.families),
  );
}
