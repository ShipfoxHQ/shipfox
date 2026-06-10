import {ZodError} from 'zod';
import simpleBuildWorkflowDocument from '#test/data/simple-build.json' with {type: 'json'};
import {
  InvalidWorkflowDocumentError,
  invalidWorkflowDocumentErrorCode,
  parseWorkflowDocument,
} from './workflow-document-parser.js';

describe('parseWorkflowDocument', () => {
  it('parses the simple build fixture', () => {
    const result = parseWorkflowDocument(simpleBuildWorkflowDocument);

    expect(result).toEqual(simpleBuildWorkflowDocument);
  });

  it('returns the parsed document when valid', () => {
    const workflowDocument = {
      name: 'simple build',
      jobs: {
        build: {
          steps: [{run: 'npm run build'}],
        },
      },
    };

    const result = parseWorkflowDocument(workflowDocument);

    expect(result).toEqual(workflowDocument);
  });

  it('throws a typed domain error when the document is invalid', () => {
    const workflowDocument = {
      name: 'simple build',
      jobs: {},
    };

    const act = () => parseWorkflowDocument(workflowDocument);

    expect(act).toThrow(InvalidWorkflowDocumentError);
    expect(act).toThrow('Invalid workflow document');
  });

  it('exposes a kebab-case serialized code for presentation boundaries', () => {
    const workflowDocument = {
      name: 'simple build',
      jobs: {},
    };

    let error: unknown;
    try {
      parseWorkflowDocument(workflowDocument);
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(InvalidWorkflowDocumentError);
    expect(error).toMatchObject({
      code: invalidWorkflowDocumentErrorCode,
      name: 'InvalidWorkflowDocumentError',
    });
  });

  it('keeps the Zod validation error as the cause', () => {
    const workflowDocument = {
      name: 'simple build',
      jobs: {},
    };

    let error: unknown;
    try {
      parseWorkflowDocument(workflowDocument);
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(InvalidWorkflowDocumentError);
    expect((error as InvalidWorkflowDocumentError).cause).toBeInstanceOf(ZodError);
    expect((error as InvalidWorkflowDocumentError).validationError).toBe(
      (error as InvalidWorkflowDocumentError).cause,
    );
    expect((error as InvalidWorkflowDocumentError).validationError.issues).toEqual([
      expect.objectContaining({path: ['jobs']}),
    ]);
  });
});
