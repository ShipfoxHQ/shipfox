import {extractTypeReferences, renderTypeReferenceSections} from './typescript-type-reference.js';

describe('typescript type reference docs', () => {
  test('extracts exported aliases and readonly object fields', () => {
    const sourceText = `
export type WorkflowId = string;

export type WorkflowIR = Readonly<{
  id: WorkflowId;
  jobs: readonly JobIR[];
  runner: RunnerSelectorIR | null;
}>;
`;

    const references = extractTypeReferences(sourceText, ['WorkflowId', 'WorkflowIR']);

    expect(references).toEqual([
      {kind: 'alias', name: 'WorkflowId', type: 'string'},
      {
        kind: 'object',
        name: 'WorkflowIR',
        fields: [
          {name: 'id', type: 'WorkflowId'},
          {name: 'jobs', type: 'readonly JobIR[]'},
          {name: 'runner', type: 'RunnerSelectorIR | null'},
        ],
      },
    ]);
  });

  test('renders deterministic markdown sections with escaped table pipes', () => {
    const sourceText = `
export type JobIR = Readonly<{
  id: JobId;
  runner: RunnerSelectorIR | null;
}>;
`;

    const sections = renderTypeReferenceSections(sourceText, ['JobIR']);

    expect(sections).toEqual([
      [
        '#### JobIR',
        '',
        '| Field | Type |',
        '| --- | --- |',
        '| `id` | `JobId` |',
        '| `runner` | `RunnerSelectorIR \\| null` |',
      ].join('\n'),
    ]);
  });

  test('fails when a requested exported alias is missing', () => {
    const sourceText = 'export type WorkflowId = string;';

    expect(() => extractTypeReferences(sourceText, ['WorkflowIR'])).toThrow(
      'Unable to find exported type alias "WorkflowIR"',
    );
  });
});
