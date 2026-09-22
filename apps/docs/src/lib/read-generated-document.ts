import 'server-only';

import {readFileSync} from 'node:fs';
import {join} from 'node:path';

const GENERATED_ROOT = join(process.cwd(), 'content', 'generated');
const DOCUMENT_ID_PATTERN = /^[a-z0-9-]+(?:\/[a-z0-9-]+)+$/u;
const documents = new Map<string, unknown>();

/** Reads a generated JSON document by its id, such as `integrations/jira/tools`. */
export function readGeneratedDocument<Document extends {id: string}>(
  label: string,
  id: string,
  isValid: (document: Document) => boolean,
): Document {
  const cached = documents.get(id);
  if (cached) return cached as Document;
  if (!DOCUMENT_ID_PATTERN.test(id)) {
    throw new Error(`${label} id "${id}" is not a generated document path.`);
  }
  const document = JSON.parse(readFileSync(join(GENERATED_ROOT, `${id}.json`), 'utf8')) as Document;
  if (document.id !== id || !isValid(document)) {
    throw new Error(`Generated ${label.toLowerCase()} "${id}" does not match its document id.`);
  }
  documents.set(id, document);
  return document;
}
