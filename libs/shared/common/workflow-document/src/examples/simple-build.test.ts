import {workflowDocumentSchema} from '#document/workflow-document.js';
import {simpleBuildWorkflowDocument} from './simple-build.js';

describe('simpleBuildWorkflowDocument', () => {
  it('matches the workflow document schema', () => {
    const result = workflowDocumentSchema.safeParse(simpleBuildWorkflowDocument);

    expect(result.success).toBe(true);
  });
});
