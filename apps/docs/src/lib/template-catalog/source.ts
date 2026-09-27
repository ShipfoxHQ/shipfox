import 'server-only';

import {readGeneratedDocument} from '@/lib/read-generated-document';
import type {TemplateCatalogDocument, TemplateCatalogEntry, TemplateDetail} from './types';

function readCatalog(): TemplateCatalogDocument {
  return readGeneratedDocument<TemplateCatalogDocument>(
    'Example catalog',
    'examples/catalog',
    (document) => Array.isArray(document.templates),
  );
}

// The gallery is a client component, so pass only the card fields and keep the
// workflow files out of its payload.
export function getTemplateCatalog(): TemplateCatalogEntry[] {
  return readCatalog().templates.map(
    ({id, title, summary, revision, addedAt, group, starts, flow, writes, roles, href}) => ({
      id,
      title,
      summary,
      revision,
      addedAt,
      group,
      starts,
      flow,
      writes,
      roles,
      href,
    }),
  );
}

export function getTemplateDetail(id: string): TemplateDetail {
  const template = readCatalog().templates.find((candidate) => candidate.id === id);
  if (!template) throw new Error(`Unknown example "${id}".`);
  return template;
}
