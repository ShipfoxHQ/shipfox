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

export function getTemplateCatalog(): TemplateCatalogEntry[] {
  return readCatalog().templates;
}

export function getTemplateDetail(id: string): TemplateDetail {
  const template = readCatalog().templates.find((candidate) => candidate.id === id);
  if (!template) throw new Error(`Unknown example "${id}".`);
  return template;
}
