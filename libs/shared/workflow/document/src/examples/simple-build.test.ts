import {parseWorkflowDocument} from '#document/workflow-document-parser.js';
import {simpleBuildWorkflowDocument} from './simple-build.js';

describe('simpleBuildWorkflowDocument', () => {
  it('parses as a workflow document', () => {
    const result = parseWorkflowDocument(simpleBuildWorkflowDocument);

    expect(result).toEqual(simpleBuildWorkflowDocument);
  });
});
