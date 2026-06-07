import {surfaceSchemaReference} from './surface-schema-reference.js';
import {
  surfaceWorkflowDocumentCueBoundaryReference,
  surfaceWorkflowDocumentCueSchema,
} from './surface-workflow-document-cue.js';

describe('surfaceWorkflowDocumentCueSchema', () => {
  test('contains every CUE definition referenced by surface schema metadata', () => {
    for (const reference of surfaceSchemaReference) {
      expect(surfaceWorkflowDocumentCueSchema).toContain(`${reference.cueDefinition}:`);
    }
  });

  test('contains every surface field referenced by the Zod-to-CUE field map', () => {
    for (const reference of surfaceSchemaReference) {
      for (const field of reference.fields) {
        const fieldMarker = `${field.name}${field.presence === 'optional' ? '?' : ''}:`;
        const fieldPattern = new RegExp(
          `${escapeRegExp(fieldMarker)}\\s+${escapeRegExp(field.cueType)}`,
          'u',
        );

        expect(surfaceWorkflowDocumentCueSchema).toMatch(fieldPattern);
      }
    }
  });
});

describe('surfaceWorkflowDocumentCueBoundaryReference', () => {
  test('documents PR1 CUE boundaries', () => {
    expect(surfaceWorkflowDocumentCueBoundaryReference.map((item) => item.capability)).toEqual([
      'CUE formalization artifact',
      'CUE authoring input',
      'CUE CLI validation',
    ]);
    expect(surfaceWorkflowDocumentCueBoundaryReference.map((item) => item.pr1Status)).toEqual([
      'included',
      'deferred',
      'deferred',
    ]);
  });

  test('documents behavior and next required work for every boundary row', () => {
    for (const item of surfaceWorkflowDocumentCueBoundaryReference) {
      expect(item.behavior.length).toBeGreaterThan(0);
      expect(item.nextRequiredWork.length).toBeGreaterThan(0);
    }
  });
});

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}
