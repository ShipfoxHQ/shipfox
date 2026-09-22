import 'server-only';

import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import type {ToolReferenceDocument} from '@/lib/tool-reference/document';

const GENERATED_ROOT = join(process.cwd(), 'content', 'generated');
const DOCUMENT_ID_PATTERN = /^[a-z0-9-]+(?:\/[a-z0-9-]+)+$/u;
const documents = new Map<string, ToolReferenceDocument>();

/** Reads a generated tool reference document by its id, such as `integrations/jira/tools`. */
export function getToolReferenceDocument(id: string): ToolReferenceDocument {
  const cached = documents.get(id);
  if (cached) return cached;
  if (!DOCUMENT_ID_PATTERN.test(id)) {
    throw new Error(`Tool reference id "${id}" is not a generated document path.`);
  }
  const document = JSON.parse(
    readFileSync(join(GENERATED_ROOT, `${id}.json`), 'utf8'),
  ) as ToolReferenceDocument;
  if (document.id !== id || !Array.isArray(document.groups)) {
    throw new Error(`Generated tool reference "${id}" does not match its document id.`);
  }
  documents.set(id, document);
  return document;
}
