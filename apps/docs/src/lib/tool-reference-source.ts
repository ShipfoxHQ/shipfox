import 'server-only';

import {readGeneratedDocument} from '@/lib/read-generated-document';
import type {ToolReferenceDocument} from '@/lib/tool-reference/document';

/** Reads a generated tool reference document by its id, such as `integrations/jira/tools`. */
export function getToolReferenceDocument(id: string): ToolReferenceDocument {
  return readGeneratedDocument<ToolReferenceDocument>('Tool reference', id, (document) =>
    Array.isArray(document.groups),
  );
}
