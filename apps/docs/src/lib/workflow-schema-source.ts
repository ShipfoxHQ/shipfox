import 'server-only';

import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {
  WORKFLOW_SCHEMA_DOCUMENT_FILE,
  type WorkflowSchemaSection,
  workflowSchemaDocumentSchema,
} from '@/lib/workflow-schema/document';

export function getWorkflowSchemaSection(id: string): WorkflowSchemaSection {
  const document = workflowSchemaDocumentSchema.parse(
    JSON.parse(readFileSync(join(process.cwd(), WORKFLOW_SCHEMA_DOCUMENT_FILE), 'utf8')),
  );
  const section = document.sections.find((candidate) => candidate.id === id);
  if (!section) {
    throw new Error(`Workflow schema section "${id}" is not in ${WORKFLOW_SCHEMA_DOCUMENT_FILE}.`);
  }
  return section;
}
